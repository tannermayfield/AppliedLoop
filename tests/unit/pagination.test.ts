import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ValidationError } from "@/lib/errors";
import { decodeCursor, encodeCursor, pageOf, pageQuerySchema } from "@/lib/pagination";

describe("cursors", () => {
  it("round-trips any JSON value as an opaque URL-safe string", () => {
    const cursor = encodeCursor({ t: "2026-10-05T12:00:00.000Z", id: "abc" });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeCursor(cursor, z.object({ t: z.string(), id: z.string() }))).toEqual({
      t: "2026-10-05T12:00:00.000Z",
      id: "abc",
    });
  });

  it("rejects garbage and wrong shapes as a validation error", () => {
    const schema = z.object({ id: z.string() });
    expect(() => decodeCursor("not-base64-json!!", schema)).toThrow(ValidationError);
    expect(() => decodeCursor(encodeCursor({ other: 1 }), schema)).toThrow(ValidationError);
  });
});

describe("pageOf", () => {
  const cursorFor = (n: number) => ({ n });

  it("returns everything and no cursor when there is no extra row", () => {
    expect(pageOf([1, 2], 2, cursorFor)).toEqual({ items: [1, 2], nextCursor: null });
  });

  it("trims the look-ahead row and points the cursor at the last visible row", () => {
    const page = pageOf([1, 2, 3], 2, cursorFor);
    expect(page.items).toEqual([1, 2]);
    expect(decodeCursor(page.nextCursor!, z.object({ n: z.number() }))).toEqual({ n: 2 });
  });
});

describe("pageQuerySchema", () => {
  it("defaults to 25 and caps at 100", () => {
    expect(pageQuerySchema.parse({}).limit).toBe(25);
    expect(pageQuerySchema.safeParse({ limit: "101" }).success).toBe(false);
    expect(pageQuerySchema.parse({ limit: "10" }).limit).toBe(10);
  });
});
