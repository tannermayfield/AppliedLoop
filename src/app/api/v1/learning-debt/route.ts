import { listDebt, listDebtQuery } from "@/domain/learning/debt";
import { addToNeedsReview, addToNeedsReviewInput } from "@/domain/learning/needs-review";
import { apiRoute } from "@/lib/api";
import { Paged, parseBody, parseQuery } from "@/lib/http";

// The Needs Review queue, newest first. Without `status`: OPEN and PLANNED.
export const GET = apiRoute(async ({ c, url }) => {
  const { items, nextCursor } = await listDebt(c, parseQuery(url, listDebtQuery));
  return new Paged(items, nextCursor);
});

// The student adds a concept to Needs Review by hand (the AI-off / failed-extraction path). 201 with
// the new item; 200 with the existing one when the concept is already OPEN or PLANNED (nothing is
// created twice). `apiRoute` passes a Response through and adds the request id.
export const POST = apiRoute(async ({ c, req }) => {
  const result = await addToNeedsReview(c, await parseBody(req, addToNeedsReviewInput));
  return Response.json({ data: result }, { status: result.created ? 201 : 200 });
});
