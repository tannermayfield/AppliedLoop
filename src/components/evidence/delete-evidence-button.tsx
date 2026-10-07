"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { api } from "@/components/sessions/api";
import { evidenceCopy } from "@/lib/copy-evidence";

const copy = evidenceCopy.detail;

export function DeleteEvidenceButton({
  evidenceId,
  leavesWithoutEvidence = [],
}: {
  evidenceId: string;
  /** Demonstrated concepts that would have no evidence left. */
  leavesWithoutEvidence?: string[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function remove() {
    setPending(true);
    setError(null);
    const result = await api(`/api/v1/evidence/${evidenceId}`, { method: "DELETE" });
    if (!result.ok) {
      setError(result.message);
      setPending(false);
      return;
    }
    router.push("/evidence");
    router.refresh();
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" className="text-destructive">
          <Trash2 aria-hidden /> {copy.delete}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.deleteTitle}</AlertDialogTitle>
          <AlertDialogDescription>
            {copy.deleteBody}
            {leavesWithoutEvidence.length > 0 && ` ${copy.deleteLeaves(leavesWithoutEvidence)}`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{copy.cancel}</AlertDialogCancel>
          {/* A plain button: the dialog stays open until the request finishes. */}
          <Button variant="destructive" onClick={remove} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Trash2 aria-hidden />}
            {pending ? copy.deleting : copy.delete}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
