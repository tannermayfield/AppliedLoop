"use client";

import { useEffect, useState } from "react";
import { api } from "@/components/sessions/api";
import type { DebtDto } from "@/domain/learning/debt";
import { copy } from "@/lib/copy";
import { NEEDS_REVIEW_COPY } from "@/lib/copy-extraction";
import { NeedsReviewItems } from "./needs-review-items";

type State = { kind: "loading" } | { kind: "error" } | { kind: "ready"; items: DebtDto[] };

/**
 * The Needs Review queue (OPEN and PLANNED learning debt) for one project, or for all of them
 * when `projectId` is omitted. Loads through GET /api/v1/learning-debt.
 */
export function NeedsReviewList({ projectId }: { projectId?: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ limit: "100" });
    if (projectId) query.set("projectId", projectId);
    api<DebtDto[]>(`/api/v1/learning-debt?${query}`).then((result) => {
      if (cancelled) return;
      setState(result.ok ? { kind: "ready", items: result.data } : { kind: "error" });
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  return (
    <section
      aria-labelledby="needs-review-list-heading"
      aria-busy={state.kind === "loading"}
      className="space-y-3"
    >
      <div>
        <h2 id="needs-review-list-heading" className="font-display text-xl font-semibold">
          {copy.needsReview.label}
        </h2>
        {state.kind === "ready" && (
          <p className="text-muted-foreground text-sm">
            {state.items.length === 0 ? copy.needsReview.empty : NEEDS_REVIEW_COPY.description}
          </p>
        )}
      </div>
      <div aria-live="polite">
        {state.kind === "loading" && (
          <p className="text-muted-foreground text-sm">{NEEDS_REVIEW_COPY.loading}</p>
        )}
        {state.kind === "error" && (
          <p className="text-destructive text-sm">{NEEDS_REVIEW_COPY.loadFailed}</p>
        )}
      </div>
      {state.kind === "ready" && state.items.length > 0 && (
        <NeedsReviewItems items={state.items} showProject={!projectId} />
      )}
    </section>
  );
}
