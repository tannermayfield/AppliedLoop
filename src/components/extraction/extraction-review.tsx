"use client";

import { useState } from "react";
import Link from "next/link";
import { api } from "@/components/sessions/api";
import { Button } from "@/components/ui/button";
import type { ExtractionItemDto } from "@/domain/extraction/items";
import { EXTRACTION_COPY } from "@/lib/copy-extraction";
import type { ExtractionDisposition, UserUnderstanding } from "@/lib/db/schema/enums";
import { ItemCard } from "./item-card";

const t = EXTRACTION_COPY;

type Patch = { userUnderstanding?: UserUnderstanding; disposition?: ExtractionDisposition };

/** The candidate list: every choice saves immediately (optimistic, rolled back on failure). */
export function ExtractionReview({
  extractionId,
  projectId,
  items: initial,
}: {
  extractionId: string;
  projectId: string;
  items: ExtractionItemDto[];
}) {
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState("");

  async function save(itemId: string, patch: Patch) {
    const before = items.find((item) => item.id === itemId);
    if (!before) return;
    setItems((current) =>
      current.map((item) => (item.id === itemId ? { ...item, ...patch } : item)),
    );
    setBusy((current) => new Set(current).add(itemId));
    setStatus(t.saving);
    const result = await api<{ item: ExtractionItemDto }>(
      `/api/v1/extractions/${extractionId}/items/${itemId}`,
      { method: "PATCH", body: patch },
    );
    setBusy((current) => {
      const next = new Set(current);
      next.delete(itemId);
      return next;
    });
    if (result.ok) {
      setItems((current) => current.map((item) => (item.id === itemId ? result.data.item : item)));
      setStatus(t.saved);
    } else {
      setItems((current) => current.map((item) => (item.id === itemId ? before : item)));
      setStatus(t.saveFailed);
    }
  }

  const reviewed = items.filter((item) => item.disposition !== "UNREVIEWED").length;
  const added = items.filter((item) => item.disposition === "NEEDS_REVIEW").length;
  const done = reviewed === items.length;

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium">
        {done ? t.allReviewed : t.progress(reviewed, items.length)}
      </p>
      <p role="status" aria-live="polite" className="sr-only">
        {status}
      </p>
      {status === t.saveFailed && <p className="text-destructive text-sm">{status}</p>}
      <div className="space-y-4">
        {items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            busy={busy.has(item.id)}
            onUnderstanding={(value) => save(item.id, { userUnderstanding: value })}
            onDisposition={(value) => save(item.id, { disposition: value })}
          />
        ))}
      </div>
      {done && (
        <section aria-live="polite" className="bg-card space-y-3 rounded-2xl border p-4 sm:p-5">
          <p className="text-sm">{t.next(added)}</p>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link href="/today">{t.goToday}</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href={`/projects/${projectId}?tab=learning`}>{t.backToProject}</Link>
            </Button>
          </div>
        </section>
      )}
    </div>
  );
}
