import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as GET_EXTRACTION } from "@/app/api/v1/extractions/[id]/route";
import { PATCH as CLASSIFY } from "@/app/api/v1/extractions/[id]/items/[itemId]/route";
import { POST as CREATE } from "@/app/api/v1/extractions/route";
import { PATCH as UPDATE_DEBT } from "@/app/api/v1/learning-debt/[id]/route";
import { GET as LIST_DEBT } from "@/app/api/v1/learning-debt/route";
import { POST as PACK } from "@/app/api/v1/sessions/[id]/context-pack/route";
import { GET as SESSION_EXTRACTION } from "@/app/api/v1/sessions/[id]/extraction/route";
import { createTestApp, type TestApp } from "@/test/app";
import { insertBuildSetup } from "@/test/factories-extraction";
import { insertApplySetup } from "@/test/factories-sessions";
import { callRoute, setRouteContext } from "@/test/route";

vi.mock("@/lib/app-context", async () => (await import("@/test/route")).appContextMock);

const scripted = {
  candidates: [
    {
      name: "Database transactions",
      category: "Database",
      whyItMatters: "Writes are grouped atomically.",
      evidence: ["transaction"],
      confidence: 0.7,
      selfAssessmentQuestion: "What does the transaction prevent?",
    },
  ],
};

describe("Build / Extraction / Needs Review routes", () => {
  let app: TestApp;
  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(() => app.close());
  beforeEach(async () => {
    await app.reset();
    setRouteContext(null);
  });

  it("answers 401 when signed out", async () => {
    expect((await callRoute(LIST_DEBT, { url: "/api/v1/learning-debt" })).status).toBe(401);
    expect(
      (await callRoute(CREATE, { url: "/api/v1/extractions", body: { buildSessionId: "x" } }))
        .status,
    ).toBe(401);
  });

  it("POST /sessions/:id/context-pack returns the pack (with or without a body); 409 for Apply", async () => {
    const alice = await app.makeUser();
    const { session } = await insertBuildSetup(app.db, alice.id);
    setRouteContext(alice.ctx);
    const url = `/api/v1/sessions/${session.id}/context-pack`;

    const withBody = await callRoute(PACK, {
      url,
      params: { id: session.id },
      body: { target: "CLAUDE_CODE" },
    });
    expect(withBody.status).toBe(200);
    expect(withBody.body.data.target).toBe("CLAUDE_CODE");
    expect(withBody.body.data.markdown).toContain("## Session goal");

    const noBody = await callRoute(PACK, { url, params: { id: session.id }, method: "POST" });
    expect(noBody.status).toBe(200);
    expect(noBody.body.data.target).toBe("GENERIC");

    const bad = await callRoute(PACK, { url, params: { id: session.id }, body: { target: "VIM" } });
    expect(bad.status).toBe(400);

    const apply = await insertApplySetup(app.db, alice.id);
    const conflict = await callRoute(PACK, {
      url,
      params: { id: apply.session.id },
      body: {},
    });
    expect(conflict.status).toBe(409);
  });

  it("POST /extractions is 201 then 200 (idempotent), and the item flow works end to end", async () => {
    const alice = await app.makeUser();
    const { session } = await insertBuildSetup(app.db, alice.id);
    setRouteContext(alice.ctx);
    app.ai.enqueue("EXTRACTION", scripted);
    const body = {
      buildSessionId: session.id,
      summary: "Wrapped profile creation in a transaction.",
      artifactRefs: [{ type: "COMMIT", value: "abc123" }],
    };

    const first = await callRoute(CREATE, { url: "/api/v1/extractions", body });
    expect(first.status).toBe(201);
    const extraction = first.body.data;
    expect(extraction.items[0]).toMatchObject({
      disposition: "UNREVIEWED",
      userUnderstanding: null,
    });

    const second = await callRoute(CREATE, { url: "/api/v1/extractions", body });
    expect(second.status).toBe(200);
    expect(second.body.data.id).toBe(extraction.id);
    expect(app.ai.callsFor("EXTRACTION")).toHaveLength(1);

    const read = await callRoute(GET_EXTRACTION, {
      url: `/api/v1/extractions/${extraction.id}`,
      params: { id: extraction.id },
    });
    expect(read.status).toBe(200);
    const bySession = await callRoute(SESSION_EXTRACTION, {
      url: `/api/v1/sessions/${session.id}/extraction`,
      params: { id: session.id },
    });
    expect(bySession.body.data.id).toBe(extraction.id);

    const itemId = extraction.items[0].id;
    const classify = (payload: unknown) =>
      callRoute(CLASSIFY, {
        url: `/api/v1/extractions/${extraction.id}/items/${itemId}`,
        params: { id: extraction.id, itemId },
        method: "PATCH",
        body: payload,
      });
    const understood = await classify({ userUnderstanding: "SHAKY" });
    expect(understood.status).toBe(200);
    expect(understood.body.data.debt).toBeNull();

    const added = await classify({ disposition: "NEEDS_REVIEW" });
    expect(added.body.data.debt).toMatchObject({
      status: "OPEN",
      conceptName: "Database transactions",
    });

    const list = await callRoute(LIST_DEBT, { url: "/api/v1/learning-debt" });
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.meta).toEqual({ nextCursor: null });

    const debtId = list.body.data[0].id;
    const resolved = await callRoute(UPDATE_DEBT, {
      url: `/api/v1/learning-debt/${debtId}`,
      params: { id: debtId },
      method: "PATCH",
      body: { status: "RESOLVED" },
    });
    expect(resolved.status).toBe(200);
    expect(resolved.body.data.status).toBe("RESOLVED");
    expect((await callRoute(LIST_DEBT, { url: "/api/v1/learning-debt" })).body.data).toEqual([]);

    const invalid = await classify({ disposition: "MASTERED" });
    expect(invalid.status).toBe(400);
  });

  it("maps AI failure to 503 and AI-off to 409 AI_DISABLED_FOR_PROJECT; Apply sessions are 409", async () => {
    const alice = await app.makeUser();
    setRouteContext(alice.ctx);
    const { session } = await insertBuildSetup(app.db, alice.id);
    app.ai.failNext("EXTRACTION");
    const failed = await callRoute(CREATE, {
      url: "/api/v1/extractions",
      body: { buildSessionId: session.id, summary: "x" },
    });
    expect(failed.status).toBe(503);

    const off = await insertBuildSetup(app.db, alice.id, { project: { aiEnabled: false } });
    const disabled = await callRoute(CREATE, {
      url: "/api/v1/extractions",
      body: { buildSessionId: off.session.id },
    });
    expect(disabled.status).toBe(409);
    expect(disabled.body.error.code).toBe("AI_DISABLED_FOR_PROJECT");

    const apply = await insertApplySetup(app.db, alice.id);
    const conflict = await callRoute(CREATE, {
      url: "/api/v1/extractions",
      body: { buildSessionId: apply.session.id },
    });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe("CONFLICT");
  });

  it("other users get 404", async () => {
    const alice = await app.makeUser();
    const bob = await app.makeUser();
    const { session } = await insertBuildSetup(app.db, alice.id);
    setRouteContext(bob.ctx);
    const res = await callRoute(PACK, {
      url: `/api/v1/sessions/${session.id}/context-pack`,
      params: { id: session.id },
      body: {},
    });
    expect(res.status).toBe(404);
    const ex = await callRoute(SESSION_EXTRACTION, {
      url: `/api/v1/sessions/${session.id}/extraction`,
      params: { id: session.id },
    });
    expect(ex.status).toBe(404);
  });
});
