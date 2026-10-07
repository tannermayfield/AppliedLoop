"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/components/sessions/api";
import { Button } from "@/components/ui/button";
import { needsReviewFlow } from "@/lib/copy-needs-review";

const t = needsReviewFlow.concept;

/**
 * On a concept that is in Needs Review: what that means and the one action that closes it. The
 * student presses it; nothing else ever resolves an item (journeys audit F-07).
 */
export function ConceptNeedsReview({
  debtId,
  conceptName,
  projectName,
}: {
  debtId: string;
  conceptName: string;
  /** The project it was added from, when it has one. */
  projectName: string | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  async function resolve() {
    setPending(true);
    setFailed(false);
    const result = await api(`/api/v1/learning-debt/${debtId}`, {
      method: "PATCH",
      body: { status: "RESOLVED" },
    });
    setPending(false);
    if (!result.ok) {
      setFailed(true);
      return;
    }
    toast.success(t.resolved(conceptName));
    // The server renders the badge and this section, so both go away with the refreshed page.
    router.refresh();
  }

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm text-pretty">
        {t.body}
        {projectName ? ` ${t.fromProject(projectName)}` : ""}
      </p>
      <div aria-live="polite">
        {failed && (
          <p role="alert" className="text-destructive text-sm">
            {t.failed}
          </p>
        )}
      </div>
      <Button type="button" variant="outline" size="sm" disabled={pending} onClick={resolve}>
        <CheckCircle2 aria-hidden />
        {pending ? t.saving : t.markResolved}
      </Button>
    </div>
  );
}
