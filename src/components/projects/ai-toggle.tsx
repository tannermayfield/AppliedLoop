"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ApiError, apiRequest } from "@/components/learning/api-client";
import { requestCopy } from "@/lib/copy-learning";
import { projectsCopy } from "@/lib/copy-projects";

const copy = projectsCopy.ai;

/**
 * "Allow AI to use this project's context" (SPEC_REVIEW R-12). Turning it off means nothing from
 * the project is sent to an AI provider; the student can still do everything by hand.
 */
export function AiToggle({ projectId, aiEnabled }: { projectId: string; aiEnabled: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(aiEnabled);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "saved" | "error"; text: string } | null>(null);

  async function change(next: boolean) {
    setEnabled(next);
    setPending(true);
    setMessage(null);
    try {
      await apiRequest(`/api/v1/projects/${projectId}`, {
        method: "PATCH",
        body: { aiEnabled: next },
      });
      setMessage({ kind: "saved", text: copy.saved });
      router.refresh();
    } catch (caught) {
      setEnabled(!next);
      setMessage({
        kind: "error",
        text: caught instanceof ApiError ? caught.message : requestCopy.unexpected,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="bg-card flex items-start gap-3 rounded-2xl border p-4 sm:p-5">
      <Switch
        id="project-ai-toggle"
        checked={enabled}
        disabled={pending}
        onCheckedChange={(next) => void change(next)}
        aria-describedby="project-ai-toggle-hint"
        className="mt-1"
      />
      <div className="grid gap-1">
        <Label htmlFor="project-ai-toggle" className="text-base">
          {copy.label}
        </Label>
        <p id="project-ai-toggle-hint" className="text-muted-foreground text-sm text-pretty">
          {enabled ? copy.onHint : copy.offHint}
        </p>
        <div aria-live="polite" className="text-sm">
          {message?.kind === "saved" && <p className="text-success">{message.text}</p>}
          {message?.kind === "error" && (
            <p role="alert" className="text-destructive">
              {message.text}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
