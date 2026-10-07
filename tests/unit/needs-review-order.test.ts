import { describe, expect, it } from "vitest";
import { pinnedFirst, topNeedsReview } from "@/components/needs-review/order";

const item = (id: string, pinned = false) => ({ id, pinned });

describe("Needs Review order", () => {
  it("puts pinned items first and keeps the incoming (newest first) order inside each group", () => {
    const items = [item("a"), item("b", true), item("c"), item("d", true)];
    expect(pinnedFirst(items).map((i) => i.id)).toEqual(["b", "d", "a", "c"]);
  });

  it("does not change the list it is given", () => {
    const items = [item("a"), item("b", true)];
    pinnedFirst(items);
    expect(items.map((i) => i.id)).toEqual(["a", "b"]);
  });

  it("takes the first three in that order by default, fewer when there are fewer", () => {
    const items = [item("a"), item("b"), item("c"), item("d", true), item("e")];
    expect(topNeedsReview(items).map((i) => i.id)).toEqual(["d", "a", "b"]);
    expect(topNeedsReview(items, 2).map((i) => i.id)).toEqual(["d", "a"]);
    expect(topNeedsReview([item("only")]).map((i) => i.id)).toEqual(["only"]);
    expect(topNeedsReview([])).toEqual([]);
  });
});
