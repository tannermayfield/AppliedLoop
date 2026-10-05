"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { ApiError, apiRequest } from "@/components/learning/api-client";
import { NativeSelect } from "@/components/learning/native-select";
import { requestCopy } from "@/lib/copy-learning";
import {
  PROJECT_STATUS_HINTS,
  PROJECT_STATUS_LABELS,
  PROJECT_STATUS_ORDER,
  projectsCopy,
} from "@/lib/copy-projects";
import type { ProjectStatus } from "@/lib/db/schema/enums";

const copy = projectsCopy.details;

/** Active, paused, complete or archived. Archiving asks first and is always reversible. */
export function ProjectStatusControl({
  projectId,
  status,
}: {
  projectId: string;
  status: ProjectStatus;
}) {
  const router = useRouter();
  const [current, setCurrent] = useState(status);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply(next: ProjectStatus) {
    const previous = current;
    setCurrent(next);
    setPending(true);
    setError(null);
    try {
      await apiRequest(`/api/v1/projects/${projectId}`, {
        method: "PATCH",
        body: { status: next },
      });
      toast.success(copy.statusChanged(PROJECT_STATUS_LABELS[next]));
      router.refresh();
    } catch (caught) {
      setCurrent(previous);
      setError(caught instanceof ApiError ? caught.message : requestCopy.unexpected);
    } finally {
      setPending(false);
    }
  }

  function onChange(next: ProjectStatus) {
    if (next === current) return;
    if (next === "ARCHIVED") setConfirmArchive(true);
    else void apply(next);
  }

  return (
    <div className="grid gap-1.5">
      <Label htmlFor="project-status">{copy.statusLabel}</Label>
      <NativeSelect
        id="project-status"
        value={current}
        disabled={pending}
        onChange={(event) => onChange(event.target.value as ProjectStatus)}
        aria-describedby="project-status-hint"
        className="sm:max-w-48"
      >
        {PROJECT_STATUS_ORDER.map((option) => (
          <option key={option} value={option}>
            {PROJECT_STATUS_LABELS[option]}
          </option>
        ))}
      </NativeSelect>
      <p id="project-status-hint" className="text-muted-foreground text-xs text-pretty">
        {PROJECT_STATUS_HINTS[current]}
      </p>
      <div aria-live="polite">
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </div>

      <AlertDialog open={confirmArchive} onOpenChange={setConfirmArchive}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.archiveConfirm.title}</AlertDialogTitle>
            <AlertDialogDescription>{copy.archiveConfirm.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{copy.archiveConfirm.cancel}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void apply("ARCHIVED")}>
              {copy.archiveConfirm.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
