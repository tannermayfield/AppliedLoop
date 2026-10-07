"use client";

import { useState } from "react";
import Link from "next/link";
import { ResolveNeedsReviewPrompt } from "@/components/needs-review/resolve-prompt";
import { Button } from "@/components/ui/button";
import { api } from "@/components/sessions/api";
import { evidenceCopy } from "@/lib/copy-evidence";

const copy = evidenceCopy.advance;

export interface AdvanceSuggestion {
  conceptId: string;
  conceptName: string;
}

type Outcome =
  /** `debtId`: the concept's open Needs Review item, when it has one (the student may close it). */
  | { kind: "done"; debtId: string | null }
  | { kind: "dismissed" }
  | { kind: "error"; message: string };

/**
 * After evidence is saved: one calm card per suggested concept. Nothing changes unless the student
 * confirms, and the change goes through the same progress route as every other stage change.
 */
export function AdvanceCards({
  suggestions,
  evidenceId,
}: {
  suggestions: AdvanceSuggestion[];
  evidenceId: string;
}) {
  const [outcomes, setOutcomes] = useState<Record<string, Outcome>>({});
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function confirm(suggestion: AdvanceSuggestion) {
    setPendingId(suggestion.conceptId);
    const result = await api(`/api/v1/concepts/${suggestion.conceptId}/progress`, {
      method: "PATCH",
      body: { stage: "DEMONSTRATED", reason: copy.reason, source: "EVIDENCE" },
    });
    // Now that the student confirmed it, ask (never decide) whether the concept's Needs Review item
    // can close. A failed lookup just means no question.
    let debtId: string | null = null;
    if (result.ok) {
      const lookup = await api<{ id: string }[]>(
        `/api/v1/learning-debt?conceptId=${encodeURIComponent(suggestion.conceptId)}&limit=1`,
      );
      debtId = lookup.ok ? (lookup.data[0]?.id ?? null) : null;
    }
    setPendingId(null);
    setOutcomes((current) => ({
      ...current,
      [suggestion.conceptId]: result.ok
        ? { kind: "done", debtId }
        : { kind: "error", message: result.message },
    }));
  }

  function dismiss(conceptId: string) {
    setOutcomes((current) => ({ ...current, [conceptId]: { kind: "dismissed" } }));
  }

  return (
    <section className="max-w-2xl space-y-4" aria-labelledby="advance-heading">
      <div className="space-y-1">
        <h2 id="advance-heading" className="font-display text-xl font-semibold">
          {copy.heading}
        </h2>
        <p className="text-muted-foreground text-sm">{copy.intro}</p>
      </div>

      <ul className="space-y-3">
        {suggestions.map((suggestion) => {
          const outcome = outcomes[suggestion.conceptId];
          const settled = outcome?.kind === "done" || outcome?.kind === "dismissed";
          return (
            <li
              key={suggestion.conceptId}
              className="bg-card space-y-2 rounded-2xl border p-4"
              aria-live="polite"
            >
              {outcome?.kind === "done" && (
                <div className="space-y-3">
                  <p role="status" className="text-sm">
                    {copy.done(suggestion.conceptName)}
                  </p>
                  {outcome.debtId && (
                    <ResolveNeedsReviewPrompt
                      debtId={outcome.debtId}
                      conceptName={suggestion.conceptName}
                      as="h3"
                    />
                  )}
                </div>
              )}
              {outcome?.kind === "dismissed" && (
                <p role="status" className="text-muted-foreground text-sm">
                  {copy.dismissed(suggestion.conceptName)}
                </p>
              )}
              {!settled && (
                <>
                  <h3 className="font-medium">{copy.prompt(suggestion.conceptName)}</h3>
                  <p className="text-muted-foreground text-sm">{copy.body}</p>
                  {outcome?.kind === "error" && (
                    <p role="alert" className="text-destructive text-sm">
                      {outcome.message}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      onClick={() => confirm(suggestion)}
                      disabled={pendingId === suggestion.conceptId}
                    >
                      {pendingId === suggestion.conceptId ? copy.confirming : copy.confirm}
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() => dismiss(suggestion.conceptId)}
                      disabled={pendingId === suggestion.conceptId}
                    >
                      {copy.notYet}
                    </Button>
                  </div>
                </>
              )}
            </li>
          );
        })}
      </ul>

      <Button asChild>
        <Link href={`/evidence/${evidenceId}`}>{copy.continue}</Link>
      </Button>
    </section>
  );
}
