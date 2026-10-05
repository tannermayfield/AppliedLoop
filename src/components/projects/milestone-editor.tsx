"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { Flag, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, apiRequest } from "@/components/learning/api-client";
import { requestCopy } from "@/lib/copy-learning";
import { projectsCopy } from "@/lib/copy-projects";

const copy = projectsCopy.overview;

/** The project's current milestone, editable in place. */
export function MilestoneEditor({
  projectId,
  milestone,
}: {
  projectId: string;
  milestone: string;
}) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(milestone);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (editing) input.current?.focus();
  }, [editing]);

  function startEditing() {
    setValue(milestone);
    setError(null);
    setEditing(true);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await apiRequest(`/api/v1/projects/${projectId}`, {
        method: "PATCH",
        body: { currentMilestone: value },
      });
      toast.success(projectsCopy.details.saved);
      setEditing(false);
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? (caught.fieldErrors().currentMilestone ?? caught.message)
          : requestCopy.unexpected,
      );
    } finally {
      setPending(false);
    }
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") setEditing(false);
  }

  return (
    <section
      aria-labelledby="milestone-heading"
      className="bg-card space-y-3 rounded-2xl border p-4 sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2
          id="milestone-heading"
          className="text-muted-foreground flex items-center gap-2 text-sm font-medium"
        >
          <Flag className="size-4" aria-hidden />
          {copy.milestoneHeading}
        </h2>
        {!editing && (
          <Button type="button" variant="ghost" size="sm" onClick={startEditing}>
            <Pencil aria-hidden />
            {milestone ? copy.editMilestone : copy.milestoneEmpty}
          </Button>
        )}
      </div>

      {editing ? (
        <form onSubmit={save} className="space-y-3">
          <Label htmlFor="milestone-input" className="sr-only">
            {copy.milestoneHeading}
          </Label>
          <Input
            ref={input}
            id="milestone-input"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder={copy.milestonePlaceholder}
            maxLength={200}
            className="h-10 sm:h-9"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              {copy.saveMilestone}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              {projectsCopy.details.cancel}
            </Button>
          </div>
        </form>
      ) : (
        <p className={milestone ? "text-lg font-medium text-pretty" : "text-muted-foreground"}>
          {milestone || copy.milestonePlaceholder}
        </p>
      )}

      <div aria-live="polite">
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </div>
    </section>
  );
}
