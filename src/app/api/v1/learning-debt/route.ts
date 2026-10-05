import { listDebt, listDebtQuery } from "@/domain/learning/debt";
import { apiRoute } from "@/lib/api";
import { Paged, parseQuery } from "@/lib/http";

// The Needs Review queue, newest first. Without `status`: OPEN and PLANNED.
export const GET = apiRoute(async ({ c, url }) => {
  const { items, nextCursor } = await listDebt(c, parseQuery(url, listDebtQuery));
  return new Paged(items, nextCursor);
});
