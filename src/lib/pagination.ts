import { z } from "zod";
import { ValidationError } from "./errors";

/** Query parameters shared by every list endpoint (docs/API.md → cursor pagination). */
export const pageQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().max(500).optional(),
});
export type PageQuery = z.output<typeof pageQuerySchema>;

/** Opaque cursor: base64url-encoded JSON. Clients must treat it as a black box. */
export function encodeCursor(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

export function decodeCursor<S extends z.ZodType>(cursor: string, schema: S): z.output<S> {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    return schema.parse(parsed);
  } catch {
    throw new ValidationError("The cursor is not valid.");
  }
}

/**
 * Standard "fetch limit + 1" paging: pass the rows you fetched (limit + 1 of them) and a function
 * that builds a cursor from the last visible row.
 */
export function pageOf<T>(rows: T[], limit: number, cursorFor: (last: T) => unknown) {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return {
    items,
    nextCursor: hasMore && last !== undefined ? encodeCursor(cursorFor(last)) : null,
  };
}
