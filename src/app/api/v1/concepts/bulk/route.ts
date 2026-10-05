import { createConceptsBulk, createConceptsBulkInput } from "@/domain/learning/concepts";
import { apiRoute } from "@/lib/api";
import { parseBody } from "@/lib/http";

// "Confirm all" for captured concepts (SPEC_REVIEW R-13). Names the student already has come back
// in `skipped`; everything else is created in one transaction.
export const POST = apiRoute(
  async ({ c, req }) => createConceptsBulk(c, await parseBody(req, createConceptsBulkInput)),
  { status: 201 },
);
