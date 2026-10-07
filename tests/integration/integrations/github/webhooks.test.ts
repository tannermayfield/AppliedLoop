import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { receiveGitHubWebhook } from "@/domain/integrations/github/webhooks";
import type { SystemContext } from "@/lib/context";
import {
  eventLog,
  evidenceItems,
  githubArtifacts,
  githubRepositories,
  githubWebhookDeliveries,
  integrations,
} from "@/lib/db/schema";
import { UnauthenticatedError, ValidationError } from "@/lib/errors";
import { UnconfiguredGitHubClient } from "@/lib/integrations/github/unconfigured";
import { createTestApp, type TestApp } from "@/test/app";
import {
  TEST_INSTALLATION_ID,
  TEST_REPO_FULL_NAME,
  TEST_REPO_ID,
  insertGitHubArtifact,
  insertLinkedProject,
} from "@/test/factories-github";
import { installationEvent, installationRepositoriesEvent } from "../../../fixtures/github";

describe("GitHub webhooks", () => {
  let app: TestApp;
  let system: SystemContext;

  beforeAll(async () => {
    app = await createTestApp();
    system = { db: app.db, github: app.github, now: app.clock.now };
  });
  afterAll(() => app.close());
  beforeEach(() => app.reset());

  let deliveries = 0;
  function delivery(
    event: string,
    payload: unknown,
    overrides: { signature?: string | null; id?: string } = {},
  ) {
    const raw = JSON.stringify(payload);
    deliveries += 1;
    return {
      rawBody: Buffer.from(raw),
      signature: overrides.signature === undefined ? app.github.sign(raw) : overrides.signature,
      event,
      deliveryId: overrides.id ?? `delivery-${deliveries}`,
    };
  }

  /** Alice and Bob both connected the same (organization) installation; Alice attached evidence. */
  async function arrange() {
    const [alice, bob] = [await app.makeUser(), await app.makeUser()];
    const mine = await insertLinkedProject(app.db, alice.id);
    const theirs = await insertLinkedProject(app.db, bob.id);
    const used = await insertGitHubArtifact(app.db, alice.id, mine.repository.id);
    const unused = await insertGitHubArtifact(app.db, alice.id, mine.repository.id, {
      externalId: "b".repeat(40),
      sha: "b".repeat(40),
    });
    await app.db.insert(evidenceItems).values({
      userId: alice.id,
      projectId: mine.project.id,
      title: "CTE refactor",
      explanation: "Mine.",
      artifactType: "COMMIT",
      artifactUrl: used.url,
      githubArtifactId: used.id,
    });
    return { alice, bob, mine, theirs, used, unused };
  }

  const statusOf = async (id: string) =>
    (await app.db.select().from(integrations).where(eq(integrations.id, id)))[0].status;

  describe("authentication", () => {
    it("rejects a missing, wrong or tampered signature and changes nothing", async () => {
      const { mine } = await arrange();
      const payload = installationEvent("deleted");
      for (const signature of [null, "sha256=" + "0".repeat(64), app.github.sign("{}")]) {
        await expect(
          receiveGitHubWebhook(system, delivery("installation", payload, { signature })),
        ).rejects.toBeInstanceOf(UnauthenticatedError);
      }
      const tampered = delivery("installation", payload);
      tampered.rawBody = Buffer.from(JSON.stringify({ ...payload, action: "suspend" }));
      await expect(receiveGitHubWebhook(system, tampered)).rejects.toBeInstanceOf(
        UnauthenticatedError,
      );

      expect(await statusOf(mine.integration.id)).toBe("CONNECTED");
      expect(await app.db.select().from(githubWebhookDeliveries)).toHaveLength(0);
    });

    it("never verifies anything when the GitHub App is not configured", async () => {
      const unconfigured: SystemContext = { ...system, github: new UnconfiguredGitHubClient() };
      await expect(
        receiveGitHubWebhook(unconfigured, delivery("installation", installationEvent("deleted"))),
      ).rejects.toBeInstanceOf(UnauthenticatedError);
    });

    it("needs the event and delivery headers and a JSON object body", async () => {
      await expect(
        receiveGitHubWebhook(system, { ...delivery("installation", {}), event: null }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        receiveGitHubWebhook(system, { ...delivery("installation", {}), deliveryId: null }),
      ).rejects.toBeInstanceOf(ValidationError);
      const raw = "not json";
      await expect(
        receiveGitHubWebhook(system, {
          rawBody: Buffer.from(raw),
          signature: app.github.sign(raw),
          event: "installation",
          deliveryId: "x",
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });
  });

  describe("installation deleted (the App was uninstalled on GitHub)", () => {
    it("disconnects everyone on that installation and marks their GitHub links stale", async () => {
      const { alice, mine, theirs, used, unused } = await arrange();
      const outcome = await receiveGitHubWebhook(
        system,
        delivery("installation", installationEvent("deleted")),
      );
      expect(outcome).toEqual({
        status: "handled",
        event: "installation",
        action: "deleted",
        affected: 2,
      });

      expect(await statusOf(mine.integration.id)).toBe("DISCONNECTED");
      expect(await statusOf(theirs.integration.id)).toBe("DISCONNECTED");
      const artifacts = await app.db.select().from(githubArtifacts);
      expect(artifacts.map((a) => a.id)).toEqual([used.id]);
      expect(artifacts[0].staleAt).not.toBeNull();
      expect(artifacts.some((a) => a.id === unused.id)).toBe(false);
      const [evidence] = await app.db.select().from(evidenceItems);
      expect(evidence).toMatchObject({ explanation: "Mine.", githubArtifactId: used.id });

      const events = await app.db
        .select()
        .from(eventLog)
        .where(eq(eventLog.eventName, "integration_disconnected"));
      expect(events.map((e) => e.userId).sort()).toEqual(
        [alice.id, theirs.integration.userId].sort(),
      );
      expect(events[0].metadataJson).toEqual({ provider: "GITHUB", via: "WEBHOOK" });
    });

    it("is idempotent by delivery id: a redelivery is acknowledged and not applied twice", async () => {
      await arrange();
      const first = delivery("installation", installationEvent("deleted"), { id: "same-delivery" });
      await receiveGitHubWebhook(system, first);
      const again = await receiveGitHubWebhook(system, { ...first });
      expect(again).toEqual({ status: "duplicate" });
      const events = await app.db
        .select()
        .from(eventLog)
        .where(eq(eventLog.eventName, "integration_disconnected"));
      expect(events).toHaveLength(2); // one per connection, from the first delivery only
    });

    it("leaves other installations alone", async () => {
      const { mine } = await arrange();
      await receiveGitHubWebhook(
        system,
        delivery("installation", installationEvent("deleted", 9999)),
      );
      expect(await statusOf(mine.integration.id)).toBe("CONNECTED");
    });
  });

  describe("installation suspend / unsuspend", () => {
    it("pauses and resumes access, but never revives a disconnected connection", async () => {
      const { mine, theirs } = await arrange();
      await app.db
        .update(integrations)
        .set({ status: "DISCONNECTED" })
        .where(eq(integrations.id, theirs.integration.id));

      await receiveGitHubWebhook(system, delivery("installation", installationEvent("suspend")));
      expect(await statusOf(mine.integration.id)).toBe("SUSPENDED");
      await receiveGitHubWebhook(system, delivery("installation", installationEvent("unsuspend")));
      expect(await statusOf(mine.integration.id)).toBe("CONNECTED");
      expect(await statusOf(theirs.integration.id)).toBe("DISCONNECTED");
      expect((await app.db.select().from(githubArtifacts)).every((a) => a.staleAt === null)).toBe(
        true,
      );
    });
  });

  describe("installation_repositories removed", () => {
    it("marks the repository removed and its links stale, for everyone on the installation", async () => {
      const { mine, theirs, used } = await arrange();
      const outcome = await receiveGitHubWebhook(
        system,
        delivery(
          "installation_repositories",
          installationRepositoriesEvent("removed", [
            { id: TEST_REPO_ID, fullName: TEST_REPO_FULL_NAME },
          ]),
        ),
      );
      expect(outcome).toMatchObject({ status: "handled", affected: 2 });
      const repositories = await app.db.select().from(githubRepositories);
      expect(repositories.every((r) => r.removedAt !== null)).toBe(true);
      expect(await statusOf(mine.integration.id)).toBe("CONNECTED");
      expect(await statusOf(theirs.integration.id)).toBe("CONNECTED");
      const [artifact] = await app.db
        .select()
        .from(githubArtifacts)
        .where(eq(githubArtifacts.id, used.id));
      expect(artifact.staleAt).not.toBeNull();
    });

    it("rolls back as a whole when the payload is malformed, so a corrected redelivery still applies", async () => {
      await arrange();
      const broken = installationRepositoriesEvent("removed", []) as Record<string, unknown>;
      delete broken.repositories_removed;
      const first = delivery("installation_repositories", broken, { id: "retry-me" });
      await expect(receiveGitHubWebhook(system, first)).rejects.toBeInstanceOf(ValidationError);
      expect(await app.db.select().from(githubWebhookDeliveries)).toHaveLength(0);

      const fixed = delivery(
        "installation_repositories",
        installationRepositoriesEvent("removed", [
          { id: TEST_REPO_ID, fullName: TEST_REPO_FULL_NAME },
        ]),
        { id: "retry-me" },
      );
      expect(await receiveGitHubWebhook(system, fixed)).toMatchObject({ status: "handled" });
    });
  });

  it("acknowledges and ignores everything else (no automation, nothing recorded)", async () => {
    const { mine } = await arrange();
    for (const [event, payload] of [
      ["installation", installationEvent("created")],
      ["installation", installationEvent("new_permissions_accepted")],
      [
        "installation_repositories",
        installationRepositoriesEvent("added", [{ id: 5, fullName: "a/b" }]),
      ],
      ["push", { ref: "refs/heads/main", installation: { id: TEST_INSTALLATION_ID } }],
      ["ping", { zen: "Keep it logically awesome." }],
    ] as const) {
      expect(await receiveGitHubWebhook(system, delivery(event, payload)), event).toEqual({
        status: "ignored",
      });
    }
    expect(await statusOf(mine.integration.id)).toBe("CONNECTED");
    expect(await app.db.select().from(githubWebhookDeliveries)).toHaveLength(0);
  });

  it("forgets deliveries after 30 days", async () => {
    await arrange();
    await app.db.insert(githubWebhookDeliveries).values({
      deliveryId: "ancient",
      event: "installation",
      action: "suspend",
      receivedAt: new Date(app.clock.now().getTime() - 31 * 24 * 60 * 60_000),
    });
    await receiveGitHubWebhook(system, delivery("installation", installationEvent("suspend")));
    const ids = (await app.db.select().from(githubWebhookDeliveries)).map((d) => d.deliveryId);
    expect(ids).not.toContain("ancient");
    expect(ids).toHaveLength(1);
  });
});
