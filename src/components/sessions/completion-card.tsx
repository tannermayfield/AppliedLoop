"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BadgeCheck } from "lucide-react";
import { ResolveNeedsReviewPrompt } from "@/components/needs-review/resolve-prompt";
import { Button } from "@/components/ui/button";
import { APPLY_COPY } from "@/lib/copy-sessions";
import { api } from "./api";
import { completionPrompts } from "./completion-state";

const t = APPLY_COPY.session;

interface Props {
  sessionId: string;
  projectId: string;
  concept: { id: string; name: string } | null;
  /** True while the concept is below Applied: show "Mark as Applied?" (the student decides). */
  suggestApplied: boolean;
  /**
   * The concept's open Needs Review item, if it has one. Once the concept is Applied the student is
   * asked whether to mark it resolved; nothing resolves on its own.
   */
  openDebtId: string | null;
}

/** After a finished Apply session: a suggested (never automatic) stage change, and evidence. */
export function CompletionCard({ sessionId, projectId, concept, suggestApplied, openDebtId }: Props) {
  const router = useRouter();
  const dismissKey = `appliedloop:apply-suggestion-dismissed:${sessionId}`;
  const [dismissed, setDismissed] = useState(false);
  const [pending, setPending] = useState(false);
  const [outcome, setOutcome] = useState<"none" | "marked" | "failed">("none");

  useEffect(() => {
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read a per-device preference once
      setDismissed(window.localStorage.getItem(dismissKey) === "1");
    } catch {
      // ignore
    }
  }, [dismissKey]);

  async function confirm() {
    if (!concept) return;
    setPending(true);
    // The progress route (Learning slice) validates this provenance server-side.
    const result = await api(`/api/v1/concepts/${concept.id}/progress`, {
      method: "PATCH",
      body: { stage: "APPLIED", reason: "Completed Apply session", source: "APPLY_COMPLETION", sessionId },
    });
    setPending(false);
    setOutcome(result.ok ? "marked" : "failed");
    if (result.ok) router.refresh();
  }

  function notYet() {
    setDismissed(true);
    try {
      window.localStorage.setItem(dismissKey, "1");
    } catch {
      // ignore
    }
  }

  const { showApplied, showResolve } = completionPrompts({
    hasConcept: concept !== null,
    suggestApplied,
    dismissed,
    appliedOutcome: outcome,
    hasOpenDebt: openDebtId !== null,
  });
  const message = outcome === "marked" ? t.marked : outcome === "failed" ? t.markFailed : null;
  const evidenceHref = `/evidence/new?sessionId=${sessionId}&projectId=${projectId}${concept ? `&conceptId=${concept.id}` : ""}`;

  return (
    <section className="bg-card space-y-3 rounded-2xl border p-4" aria-live="polite">
      {concept && showApplied && (
        <div className="space-y-2">
          <h2 className="font-medium">{t.markApplied(concept.name)}</h2>
          <p className="text-muted-foreground text-sm">{t.markAppliedBody}</p>
          <div className="flex gap-2">
            <Button onClick={confirm} disabled={pending}>
              {t.confirm}
            </Button>
            <Button variant="outline" onClick={notYet} disabled={pending}>
              {t.notYet}
            </Button>
          </div>
        </div>
      )}
      {message && <p role="status" className="text-sm">{message}</p>}
      {concept && openDebtId && showResolve && (
        <ResolveNeedsReviewPrompt
          debtId={openDebtId}
          conceptName={concept.name}
          as="h2"
          dismissKey={`appliedloop:needs-review-resolve-dismissed:${openDebtId}`}
        />
      )}
      <Button asChild variant="outline">
        <Link href={evidenceHref}>
          <BadgeCheck aria-hidden /> {t.createEvidence}
        </Link>
      </Button>
    </section>
  );
}
