import { createExtractionInput, createOrGetExtraction } from "@/domain/extraction/extract";
import { apiRoute } from "@/lib/api";
import { parseBody } from "@/lib/http";

// One model call: at most 2 attempts x 60 s (src/lib/ai/run.ts) plus 60 s of margin.
// tests/unit/ai-route-limits.test.ts keeps this number honest.
export const maxDuration = 180;

// 201 when the extraction is new; 200 with the stored one when the session already has it
// (idempotent: no second AI call).
export const POST = apiRoute(async ({ c, req }) => {
  const { extraction, created } = await createOrGetExtraction(
    c,
    await parseBody(req, createExtractionInput),
  );
  return Response.json({ data: extraction }, { status: created ? 201 : 200 });
});
