"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";
import { api } from "@/components/sessions/api";
import { Button } from "@/components/ui/button";
import { EXTRACTION_COPY } from "@/lib/copy-extraction";

/**
 * Look for concepts in a finished Build session that has no extraction yet (e.g. the AI step
 * failed earlier). Uses the summary stored with the session.
 */
export function RetryExtraction({
  sessionId,
  label = EXTRACTION_COPY.tryAgain,
  goToReview = false,
}: {
  sessionId: string;
  label?: string;
  /** Navigate to the review page on success (from the session page); otherwise just refresh. */
  goToReview?: boolean;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function retry() {
    setPending(true);
    setMessage(null);
    const result = await api("/api/v1/extractions", { body: { buildSessionId: sessionId } });
    setPending(false);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    if (goToReview) router.push(`/sessions/${sessionId}/extract`);
    else router.refresh();
  }

  return (
    <div className="space-y-2">
      <Button type="button" onClick={retry} disabled={pending}>
        <Sparkles aria-hidden />
        {pending ? EXTRACTION_COPY.retrying : label}
      </Button>
      <p role="status" aria-live="polite" className="text-muted-foreground text-sm">
        {message}
      </p>
    </div>
  );
}
