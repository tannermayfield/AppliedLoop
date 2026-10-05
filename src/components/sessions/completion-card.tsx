"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BadgeCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APPLY_COPY } from "@/lib/copy-sessions";
import { api } from "./api";

const t = APPLY_COPY.session;

interface Props {
  sessionId: string;
  projectId: string;
  concept: { id: string; name: string } | null;
  /** True while the concept is below Applied: show "Mark as Applied?" (the student decides). */
  suggestApplied: boolean;
}

/** After a finished Apply session: a suggested (never automatic) stage change, and evidence. */
export function CompletionCard({ sessionId, projectId, concept, suggestApplied }: Props) {
  const router = useRouter();
  const dismissKey = `appliedloop:apply-suggestion-dismissed:${sessionId}`;
  const [dismissed, setDismissed] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
    setMessage(result.ok ? t.marked : t.markFailed);
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

  const evidenceHref = `/evidence/new?sessionId=${sessionId}&projectId=${projectId}${concept ? `&conceptId=${concept.id}` : ""}`;

  return (
    <section className="bg-card space-y-3 rounded-2xl border p-4" aria-live="polite">
      {concept && suggestApplied && !dismissed && !message && (
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
      <Button asChild variant="outline">
        <Link href={evidenceHref}>
          <BadgeCheck aria-hidden /> {t.createEvidence}
        </Link>
      </Button>
    </section>
  );
}
