import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, type ReactElement } from "react";
import LearnPage from "@/app/(authenticated)/(app)/learn/page";
import ConceptPage from "@/app/(authenticated)/(app)/learn/concepts/[id]/page";
import ProjectsPage from "@/app/(authenticated)/(app)/projects/page";
import { EvidenceTab } from "@/components/projects/tabs/evidence-tab";
import NewProjectPage from "@/app/(authenticated)/(app)/projects/new/page";
import ProjectPage from "@/app/(authenticated)/(app)/projects/[id]/page";
import OnboardingPage from "@/app/(authenticated)/onboarding/page";
import { completeOnboarding } from "@/domain/identity/onboarding";
import { createTestApp, type TestApp } from "@/test/app";
import {
  insertConcept,
  insertProject,
  insertSession,
  insertSkill,
  insertSource,
} from "@/test/factories";
import {
  insertEvidence,
  insertDebtItem,
  linkConceptSkill,
  linkProjectSkill,
} from "@/test/factories-learning";
import { setRouteContext } from "@/test/route";

vi.mock("@/lib/app-context", async () => (await import("@/test/route")).appContextMock);
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh() {}, push() {}, replace() {} }),
  usePathname: () => "/",
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));

const html = async (page: Promise<ReactElement>) => renderToStaticMarkup(await page);
const params = <T>(value: T) => Promise.resolve(value);
const noQuery = params<Record<string, string>>({});

describe("pages render with real data", () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await app.reset();
    setRouteContext(null);
  });

  it("Learn: empty state, then grouped concepts with stage menu, Apply link and sources", async () => {
    const alice = await app.makeUser();
    setRouteContext(alice.ctx);
    const empty = await html(LearnPage({ searchParams: noQuery }) as Promise<ReactElement>);
    expect(empty).toContain("Nothing captured yet");
    expect(empty).toContain("No sources yet");

    const source = await insertSource(app.db, alice.id, { title: "IS 402" });
    const concept = await insertConcept(app.db, alice.id, {
      name: "CTEs",
      learningSourceId: source.id,
      capturedAt: app.clock.now(),
    });
    const page = await html(LearnPage({ searchParams: noQuery }) as Promise<ReactElement>);
    expect(page).toContain("Recently learned");
    expect(page).toContain("IS 402");
    expect(page).toContain(`/apply/new?conceptId=${concept.id}`);
    expect(page).toContain(`/learn/concepts/${concept.id}`);
    expect(page).toContain("What did you learn?");
  });

  it("Concept detail renders, and 404s for someone else's concept", async () => {
    const [alice, bob] = [await app.makeUser(), await app.makeUser()];
    const sql = await insertSkill(app.db, { name: "SQL" });
    const concept = await insertConcept(app.db, alice.id, { name: "CTEs" });
    await linkConceptSkill(app.db, concept.id, sql.id);
    setRouteContext(alice.ctx);
    const page = await html(
      ConceptPage({ params: params({ id: concept.id }) }) as Promise<ReactElement>,
    );
    expect(page).toContain("CTEs");
    expect(page).toContain("History");
    expect(page).toContain("SQL");

    setRouteContext(bob.ctx);
    await expect(ConceptPage({ params: params({ id: concept.id }) })).rejects.toThrow("NOT_FOUND");
  });

  it("Projects list, new form and project tabs render", async () => {
    const alice = await app.makeUser();
    setRouteContext(alice.ctx);
    expect(await html(ProjectsPage({ searchParams: noQuery }) as Promise<ReactElement>)).toContain(
      "No projects yet",
    );
    expect(renderToStaticMarkup(createElement(NewProjectPage))).toContain("I&#x27;m starting one");

    const sql = await insertSkill(app.db, { name: "SQL" });
    const project = await insertProject(app.db, alice.id, { name: "Adaptive Language" });
    await linkProjectSkill(app.db, project.id, sql.id);
    const concept = await insertConcept(app.db, alice.id, { name: "CTEs" });
    await linkConceptSkill(app.db, concept.id, sql.id);
    await insertDebtItem(app.db, alice.id, concept.id, project.id);
    await insertEvidence(app.db, alice.id, project.id, { title: "Mastery JOIN query" });
    await insertSession(app.db, alice.id, project.id, { status: "ACTIVE", goal: "Profiles" });

    expect(await html(ProjectsPage({ searchParams: noQuery }) as Promise<ReactElement>)).toContain(
      "Adaptive Language",
    );

    const view = (tab?: string) =>
      html(
        ProjectPage({
          params: params({ id: project.id }),
          searchParams: params(tab ? { tab } : {}),
        }) as Promise<ReactElement>,
      );
    const overview = await view();
    for (const text of [
      "Start Apply",
      "Start Build Session",
      "Allow AI to use this project",
      "Mastery JOIN query",
      "A session is in progress",
      "Version history",
    ]) {
      expect(overview).toContain(text);
    }
    expect(overview).toContain(`/apply/new?projectId=${project.id}`);
    expect(await view("learning")).toContain("CTEs");
    // The Evidence tab is an async server component, which the synchronous renderer cannot suspend
    // on, so resolve it directly and render its output.
    expect(renderToStaticMarkup(await EvidenceTab({ projectId: project.id }))).toContain(
      "Mastery JOIN query",
    );
    // The Sessions tab loads its list in the browser (a client component), so the server render
    // only needs to show the tab itself.
    expect(await view("sessions")).toContain("Sessions");

    setRouteContext((await app.makeUser()).ctx);
    await expect(view()).rejects.toThrow("NOT_FOUND");
  });

  it("Onboarding renders for a new student and redirects a finished one", async () => {
    const alice = await app.makeUser();
    setRouteContext(alice.ctx);
    expect(await html(OnboardingPage() as Promise<ReactElement>)).toContain(
      "What are you learning?",
    );
    await completeOnboarding(alice.ctx, {});
    await expect(OnboardingPage()).rejects.toThrow("REDIRECT:/today");
  });
});
