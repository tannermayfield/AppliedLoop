"use client";

import { useEffect, useId, useState } from "react";
import { Button } from "@/components/ui/button";
import { api } from "@/components/sessions/api";
import { needsReviewFlow } from "@/lib/copy-needs-review";

const t = needsReviewFlow.resolve;

interface Props {
  /** The Needs Review item (learning debt) to close. Always the caller's: the API checks it. */
  debtId: string;
  conceptName: string;
  /** Heading level, so the prompt fits under whatever heading it is placed beneath. */
  as?: "h2" | "h3";
  /** When set, "Not yet" is remembered on this device (like the "Mark as Applied?" prompt). */
  dismissKey?: string;
}

type Phase = "ask" | "saving" | "resolved" | "kept";

/**
 * "Mark X as resolved?", shown right after the student confirms a concept as Applied or
 * Demonstrated while it is still in Needs Review (journeys audit F-07). Closing the item is the
 * student's decision and only happens on Confirm: nothing here resolves anything automatically.
 */
export function ResolveNeedsReviewPrompt({ debtId, conceptName, as: Heading = "h3", dismissKey }: Props) {
  const headingId = useId();
  const [phase, setPhase] = useState<Phase>("ask");
  const [failed, setFailed] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    if (!dismissKey) return;
    try {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- read a per-device preference once
      setHidden(window.localStorage.getItem(dismissKey) === "1");
    } catch {
      // Storage can be blocked: the prompt then simply stays.
    }
  }, [dismissKey]);

  async function confirm() {
    setPhase("saving");
    setFailed(false);
    const result = await api(`/api/v1/learning-debt/${debtId}`, {
      method: "PATCH",
      body: { status: "RESOLVED" },
    });
    if (result.ok) {
      setPhase("resolved");
      return;
    }
    setFailed(true);
    setPhase("ask");
  }

  function notYet() {
    setPhase("kept");
    if (!dismissKey) return;
    try {
      window.localStorage.setItem(dismissKey, "1");
    } catch {
      // Not remembering is fine.
    }
  }

  if (hidden) return null;

  if (phase === "resolved" || phase === "kept") {
    return (
      <p role="status" className={phase === "kept" ? "text-muted-foreground text-sm" : "text-sm"}>
        {phase === "resolved" ? t.done(conceptName) : t.stays(conceptName)}
      </p>
    );
  }

  return (
    <div role="group" aria-labelledby={headingId} className="space-y-2">
      <Heading id={headingId} className="font-medium">
        {t.prompt(conceptName)}
      </Heading>
      <p className="text-muted-foreground text-sm">{t.body}</p>
      {failed && (
        <p role="alert" className="text-destructive text-sm">
          {t.failed}
        </p>
      )}
      <div className="flex gap-2">
        <Button onClick={confirm} disabled={phase === "saving"}>
          {phase === "saving" ? t.saving : t.confirm}
        </Button>
        <Button variant="outline" onClick={notYet} disabled={phase === "saving"}>
          {t.notYet}
        </Button>
      </div>
    </div>
  );
}
