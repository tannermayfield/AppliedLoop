import { updateDebt, updateDebtInput } from "@/domain/learning/debt";
import { apiRoute } from "@/lib/api";
import { parseBody } from "@/lib/http";

export const PATCH = apiRoute(async ({ c, req, params }) =>
  updateDebt(c, params.id, await parseBody(req, updateDebtInput)),
);
