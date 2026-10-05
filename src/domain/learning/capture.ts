import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import type { AppContext } from "@/lib/context";
import { concepts, learningSources } from "@/lib/db/schema";
import { runAi } from "@/lib/ai/run";
import { parseOrThrow } from "@/lib/errors";
import { normalizeConceptName, slugify } from "@/lib/normalize";
import { ownedBy, requireRow } from "@/lib/ownership";
import { capturePrompt } from "@/prompts/capture/v1";
import { listSkills } from "./skills";

// Concept capture (SPEC §3 "Learn journey"): free text in, candidate concepts out. Nothing is
// saved here. The student confirms or edits the candidates, and the UI saves them through
// `createConceptsBulk` (POST /concepts/bulk). If the model is unavailable the typed errors
// propagate and the UI falls back to manual entry (AT-03).

export const MAX_CAPTURE_CHARS = 4000;
const MAX_NAME = 120;
const MAX_DESCRIPTION = 1000;

export const captureInput = z.object({
  learningSourceId: z
    .guid()
    .nullish()
    .transform((value) => value ?? null),
  text: z
    .string()
    .trim()
    .min(1, "Type what you learned first")
    .max(MAX_CAPTURE_CHARS, `Keep it under ${MAX_CAPTURE_CHARS} characters`),
});
export type CaptureInput = z.input<typeof captureInput>;

export interface CaptureCandidate {
  name: string;
  description: string;
  suggestedSkillIds: string[];
  suggestedStage: "EXPOSED" | "LEARNED";
  /** How sure the model is that the text names this concept. NOT a measure of the student's mastery. */
  confidence: number;
  /** Set when the student already has a concept with this (normalized) name. */
  existingConceptId: string | null;
}

/** `POST /concepts/capture`. Read-only apart from the `ai_runs` row `runAi` writes. */
export async function captureConcepts(
  c: AppContext,
  raw: CaptureInput,
): Promise<{ candidates: CaptureCandidate[] }> {
  const input = parseOrThrow(captureInput, raw);

  let source: { title: string; code: string | null } | null = null;
  if (input.learningSourceId) {
    const [row] = await c.db
      .select({ title: learningSources.title, code: learningSources.code })
      .from(learningSources)
      .where(
        and(
          eq(learningSources.id, input.learningSourceId),
          ownedBy(learningSources.userId, c.auth),
        ),
      );
    source = requireRow(row, "Learning source");
  }

  const knownSkills = await listSkills(c);
  const { output } = await runAi(c, capturePrompt, {
    text: input.text,
    source,
    knownSkills: knownSkills.map((skill) => ({ id: skill.id, name: skill.name })),
  });

  const skillIdByKey = new Map<string, string>();
  for (const skill of knownSkills) {
    skillIdByKey.set(skill.name.trim().toLowerCase(), skill.id);
    skillIdByKey.set(skill.slug, skill.id);
  }
  const resolveSkills = (names: string[]) => {
    const ids = new Set<string>();
    for (const name of names) {
      const id = skillIdByKey.get(name.trim().toLowerCase()) ?? skillIdByKey.get(slugify(name));
      if (id) ids.add(id);
    }
    return [...ids];
  };

  // The first mention of a name wins; names with no letters or numbers cannot become concepts.
  const unique = new Map<string, (typeof output.candidates)[number]>();
  for (const candidate of output.candidates) {
    const key = normalizeConceptName(candidate.name);
    if (key !== "" && !unique.has(key)) unique.set(key, candidate);
  }

  const existing = await existingConceptIds(c, [...unique.keys()]);
  const candidates = [...unique.entries()].map(([key, candidate]) => ({
    name: candidate.name.trim().slice(0, MAX_NAME),
    description: candidate.description.trim().slice(0, MAX_DESCRIPTION),
    suggestedSkillIds: resolveSkills(candidate.suggestedSkillNames),
    suggestedStage: candidate.suggestedStage,
    confidence: candidate.confidence,
    existingConceptId: existing.get(key) ?? null,
  }));
  return { candidates };
}

async function existingConceptIds(
  c: AppContext,
  normalizedNames: string[],
): Promise<Map<string, string>> {
  if (normalizedNames.length === 0) return new Map();
  const rows = await c.db
    .select({ id: concepts.id, normalizedName: concepts.normalizedName })
    .from(concepts)
    .where(
      and(inArray(concepts.normalizedName, normalizedNames), ownedBy(concepts.userId, c.auth)),
    );
  return new Map(rows.map((row) => [row.normalizedName, row.id]));
}
