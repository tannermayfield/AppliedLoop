import type { extractionItems } from "@/lib/db/schema";
import type { ArtifactType, ExtractionDisposition, UserUnderstanding } from "@/lib/db/schema/enums";
import { normalizeConceptName } from "@/lib/normalize";

/** One candidate as the API returns it. Model-written and student-written fields stay separate. */
export interface ExtractionItemDto {
  id: string;
  name: string;
  category: string;
  /** Model-written: why it mattered in this build. Never a statement about the student. */
  reason: string;
  evidenceRefs: string[];
  /** The model's confidence that the concept was involved (not the student's mastery). */
  confidence: number | null;
  selfAssessmentQuestion: string;
  /** Student-written only. Null until they answer. */
  userUnderstanding: UserUnderstanding | null;
  disposition: ExtractionDisposition;
  /** The student's concept with the same normalized name, if they have one. */
  existingConceptId: string | null;
}

export function toItemDto(row: typeof extractionItems.$inferSelect): ExtractionItemDto {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    reason: row.reason,
    evidenceRefs: row.evidenceRefsJson,
    confidence: row.modelConfidence,
    selfAssessmentQuestion: row.selfAssessmentQuestion,
    userUnderstanding: row.userUnderstanding,
    disposition: row.disposition,
    existingConceptId: row.normalizedConceptId,
  };
}

// Post-processing of the model's extraction candidates (pure). The model only suggests; this code
// makes sure what it suggests is grounded in what the student gave us and never talks about the
// student's understanding (SPEC §5 Extraction, invariants 1 and 4 of the Build slice).

export interface RawCandidate {
  name: string;
  category: string;
  whyItMatters: string;
  evidence: string[];
  confidence: number;
  selfAssessmentQuestion: string;
}

export interface ProcessedItem {
  name: string;
  normalizedName: string;
  category: string;
  reason: string;
  evidenceRefs: string[];
  confidence: number;
  selfAssessmentQuestion: string;
  /** The student's existing concept with the same normalized name, if any. */
  normalizedConceptId: string | null;
}

export interface PostProcessContext {
  summary: string;
  notes: string;
  artifactRefs: { type: ArtifactType; value: string }[];
  /** normalized name → concept id, for the student's existing concepts. */
  knownConcepts: Map<string, string>;
}

export const MAX_ITEMS = 8;
export const FALLBACK_EVIDENCE = "Build summary";
export const NO_ARTIFACT_CONFIDENCE_CAP = 0.75;
const MAX = {
  name: 120,
  category: 60,
  reason: 600,
  question: 300,
  evidence: 300,
  refs: 6,
} as const;

/**
 * Text that addresses what the student does or doesn't understand or know. Extraction may never
 * say this (CLAUDE.md: "Never claim to know what the student does or does not understand").
 */
const STUDENT_CLAIMS = [
  /\byou (do not|don't|dont|lack|failed to|fail to|did not|didn't)( yet)? (fully )?understand/i,
  /\byou (probably |clearly |likely )?(don't|do not|dont|did not|didn't) know\b/i,
  /\byou lack\b/i,
  /\byour (lack of|gap|gaps|weakness|weaknesses|misunderstanding)\b/i,
  /\b(the )?(student|user|learner)( probably| clearly| likely)? (does not|doesn't|did not|didn't|lacks?|may not|might not) (fully )?(understand|know)/i,
];

export function claimsAboutStudent(text: string): boolean {
  return STUDENT_CLAIMS.some((pattern) => pattern.test(text));
}

/** The text, or "" when it makes a claim about the student's understanding. */
export function withoutStudentClaims(text: string): string {
  return claimsAboutStudent(text) ? "" : text;
}

/**
 * Keep only evidence that appears (case-insensitively) in what the student provided, so the
 * model cannot invent file paths or commits. Nothing left → `["Build summary"]`.
 */
export function filterEvidence(refs: string[], sources: string[]): string[] {
  const haystack = sources.map((source) => source.toLowerCase()).filter(Boolean);
  const kept: string[] = [];
  const seen = new Set<string>();
  for (const raw of refs) {
    const ref = raw.trim().slice(0, MAX.evidence);
    const key = ref.toLowerCase();
    if (!ref || seen.has(key)) continue;
    if (!haystack.some((source) => source.includes(key))) continue;
    seen.add(key);
    kept.push(ref);
    if (kept.length >= MAX.refs) break;
  }
  return kept.length > 0 ? kept : [FALLBACK_EVIDENCE];
}

/** Clamp to [0, 1]; without artifact refs the model can't be very sure (AT-13). */
export function capConfidence(value: number, hasArtifacts: boolean): number {
  const clamped = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
  return hasArtifacts ? clamped : Math.min(clamped, NO_ARTIFACT_CONFIDENCE_CAP);
}

function clip(text: string, max: number): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

export function postProcessCandidates(
  candidates: RawCandidate[],
  context: PostProcessContext,
): ProcessedItem[] {
  const sources = [context.summary, context.notes, ...context.artifactRefs.map((ref) => ref.value)];
  const hasArtifacts = context.artifactRefs.length > 0;
  const items: ProcessedItem[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const name = clip(candidate.name, MAX.name);
    const normalizedName = normalizeConceptName(name);
    if (!normalizedName || seen.has(normalizedName)) continue;
    seen.add(normalizedName);
    items.push({
      name,
      normalizedName,
      category: clip(candidate.category, MAX.category) || "General",
      reason: withoutStudentClaims(clip(candidate.whyItMatters, MAX.reason)),
      evidenceRefs: filterEvidence(candidate.evidence, sources),
      confidence: capConfidence(candidate.confidence, hasArtifacts),
      selfAssessmentQuestion: withoutStudentClaims(
        clip(candidate.selfAssessmentQuestion, MAX.question),
      ),
      normalizedConceptId: context.knownConcepts.get(normalizedName) ?? null,
    });
    if (items.length >= MAX_ITEMS) break;
  }
  return items;
}
