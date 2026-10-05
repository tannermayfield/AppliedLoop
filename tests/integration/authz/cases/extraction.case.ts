import { eq } from "drizzle-orm";
import { classifyItem } from "@/domain/extraction/dispositions";
import {
  createExtraction,
  getExtraction,
  getExtractionForSession,
} from "@/domain/extraction/extract";
import { buildContextPack } from "@/domain/sessions/build/context-pack";
import {
  concepts,
  extractionItems,
  extractions,
  learningDebtItems,
  sessions,
} from "@/lib/db/schema";
import type { TestApp } from "@/test/app";
import { insertBuildSetup, insertExtractionSetup } from "@/test/factories-extraction";
import { authzCase } from "../harness";

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

async function itemRow(app: TestApp, id: string) {
  const [row] = await app.db.select().from(extractionItems).where(eq(extractionItems.id, id));
  return row;
}

const cases = [
  authzCase({
    name: "build/context-pack.buildContextPack",
    arrange: async (app, owner) => (await insertBuildSetup(app.db, owner.id)).session.id,
    attempt: (_app, caller, id) => buildContextPack(caller.ctx, id, { target: "GENERIC" }),
  }),
  authzCase({
    name: "extraction/extract.createExtraction",
    arrange: async (app, owner) => (await insertBuildSetup(app.db, owner.id)).session.id,
    attempt: async (app, caller, id) => {
      // Script the model only for the owner: an intruder must be refused before any AI call.
      const [own] = await app.db.select().from(sessions).where(eq(sessions.id, id));
      if (own.userId === caller.id) app.ai.enqueue("EXTRACTION", scripted);
      return createExtraction(caller.ctx, { buildSessionId: id, summary: "Added a transaction." });
    },
    verifyUntouched: async (app, _owner, id) => {
      const [session] = await app.db.select().from(sessions).where(eq(sessions.id, id));
      if (session.status !== "ACTIVE") throw new Error("Session was completed by another user");
      if ((await app.db.select().from(extractions)).length > 0) {
        throw new Error("An extraction was created by another user");
      }
      if (app.ai.callsFor("EXTRACTION").length > 0) throw new Error("The model was called");
    },
  }),
  authzCase({
    name: "extraction/extract.getExtraction",
    arrange: async (app, owner) => (await insertExtractionSetup(app.db, owner.id)).extraction.id,
    attempt: (_app, caller, id) => getExtraction(caller.ctx, id),
  }),
  authzCase({
    name: "extraction/extract.getExtractionForSession",
    arrange: async (app, owner) => (await insertExtractionSetup(app.db, owner.id)).session.id,
    attempt: (_app, caller, id) => getExtractionForSession(caller.ctx, id),
  }),
  authzCase({
    name: "extraction/dispositions.classifyItem",
    arrange: async (app, owner) => {
      const { extraction, item } = await insertExtractionSetup(app.db, owner.id);
      return `${extraction.id}|${item.id}`;
    },
    attempt: (_app, caller, ids) => {
      const [extractionId, itemId] = ids.split("|");
      return classifyItem(caller.ctx, extractionId, itemId, {
        disposition: "NEEDS_REVIEW",
        userUnderstanding: "NOT_YET",
      });
    },
    verifyUntouched: async (app, _owner, ids) => {
      const item = await itemRow(app, ids.split("|")[1]);
      if (item.disposition !== "UNREVIEWED" || item.userUnderstanding !== null) {
        throw new Error("Item was classified by another user");
      }
      if ((await app.db.select().from(learningDebtItems)).length > 0)
        throw new Error("Debt was created");
      if ((await app.db.select().from(concepts)).length > 0) throw new Error("Concept was created");
    },
  }),
];

export default cases;
