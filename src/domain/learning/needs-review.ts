import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { ensureConcept, openDebt } from "@/domain/extraction/dispositions";
import { requireOwnedProject } from "@/domain/projects/context";
import { inTransaction, type AppContext } from "@/lib/context";
import { concepts } from "@/lib/db/schema";
import { parseOrThrow } from "@/lib/errors";
import { normalizeConceptName } from "@/lib/normalize";
import { ownedBy, requireRow } from "@/lib/ownership";
import { getDebt, type DebtDto } from "./debt";

// The manual way into Needs Review (journeys audit F-08). With AI off, or after a failed
// extraction, there are no candidates to classify, so the student names a concept themselves. It is
// the same choice as "Add to Needs Review" on a candidate and uses the same helpers: the concept is
// found or created (Exposed, no source) and an OPEN item is opened, in ONE transaction. Only the
// student's own request ever gets here: nothing in the app or any model calls it.

const NAME_NEEDS_LETTERS = "Use letters or numbers in the name";

export const addToNeedsReviewInput = z
  .object({
    /** A concept to find by name (matched like a duplicate would be) or create. */
    conceptName: z
      .string()
      .trim()
      .min(1, "Give the concept a name")
      .max(120)
      .optional(),
    /** Or one of the student's existing concepts. Exactly one of the two. */
    conceptId: z.guid().optional(),
    /** The project it came up in, when the student says so. */
    projectId: z
      .guid()
      .nullish()
      .transform((value) => value ?? null),
    notes: z
      .string()
      .trim()
      .max(2_000)
      .nullish()
      .transform((value) => value ?? ""),
  })
  .superRefine((input, ctx) => {
    if ((input.conceptName === undefined) === (input.conceptId === undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["conceptName"],
        message: "Give either a concept name or one of your concepts.",
      });
    } else if (input.conceptName !== undefined && normalizeConceptName(input.conceptName) === "") {
      ctx.addIssue({ code: "custom", path: ["conceptName"], message: NAME_NEEDS_LETTERS });
    }
  });
export type AddToNeedsReviewInput = z.input<typeof addToNeedsReviewInput>;

export interface AddToNeedsReviewResult {
  debt: DebtDto;
  /** False when the concept was already in Needs Review: that item is returned, nothing is added. */
  created: boolean;
}

/**
 * `POST /learning-debt`. Puts a concept the student chose into Needs Review: finds or creates the
 * concept (a new one starts at Exposed, never changes an existing one's stage) and opens an OPEN
 * item for it, in one transaction. Asking again for a concept that is already OPEN or PLANNED
 * returns that item (`created: false`). A concept or project that is not the caller's is NOT_FOUND
 * and nothing is created, not even the concept a name would have made.
 */
export async function addToNeedsReview(
  c: AppContext,
  raw: AddToNeedsReviewInput,
): Promise<AddToNeedsReviewResult> {
  const input = parseOrThrow(addToNeedsReviewInput, raw);

  return inTransaction(c, async (tx) => {
    // Ownership first, before anything is written.
    const projectId = input.projectId ? await requireOwnedProject(tx, input.projectId) : null;

    let conceptId: string;
    if (input.conceptId !== undefined) {
      const [owned] = await tx.db
        .select({ id: concepts.id })
        .from(concepts)
        .where(and(eq(concepts.id, input.conceptId), ownedBy(concepts.userId, tx.auth)));
      conceptId = requireRow(owned, "Concept").id;
    } else {
      const name = input.conceptName!;
      conceptId = await ensureConcept(tx, name, normalizeConceptName(name), "MANUAL");
    }

    const opened = await openDebt(tx, {
      conceptId,
      projectId,
      sessionId: null,
      itemId: null,
      notes: input.notes,
    });
    return { debt: await getDebt(tx, opened.id), created: opened.created };
  });
}
