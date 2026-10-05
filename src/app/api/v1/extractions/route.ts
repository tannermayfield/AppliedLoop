import { createExtractionInput, createOrGetExtraction } from "@/domain/extraction/extract";
import { apiRoute } from "@/lib/api";
import { parseBody } from "@/lib/http";

// 201 when the extraction is new; 200 with the stored one when the session already has it
// (idempotent: no second AI call).
export const POST = apiRoute(async ({ c, req }) => {
  const { extraction, created } = await createOrGetExtraction(
    c,
    await parseBody(req, createExtractionInput),
  );
  return Response.json({ data: extraction }, { status: created ? 201 : 200 });
});
