"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2 } from "lucide-react";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StageBadge } from "@/components/stage-badge";
import { STAGES, STAGE_DESCRIPTIONS, STAGE_LABELS, learnCopy } from "@/lib/copy-learning";
import type { ConceptStage } from "@/lib/db/schema/enums";
import { ApiError, apiRequest } from "./api-client";

interface Props {
  conceptId: string;
  conceptName: string;
  stage: ConceptStage;
}

type Notice = { kind: "needs-evidence" } | { kind: "error"; text: string };

interface StageChangeResult {
  changed: boolean;
  to: ConceptStage;
}

/**
 * The inline stage control. The student moves a concept; the app only records it. Comfortable asks
 * for an explicit confirmation (it is the student's own call), and Demonstrated explains itself
 * when the server says evidence is still missing.
 *
 * The parent re-mounts this with `key={stage}` when the server sends a new stage, so the local
 * `shown` value never drifts from the data.
 */
export function StageMenu({ conceptId, conceptName, stage }: Props) {
  const router = useRouter();
  const [shown, setShown] = useState(stage);
  const [pending, setPending] = useState(false);
  const [confirmComfortable, setConfirmComfortable] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  async function move(body: { stage: ConceptStage; selfAttest?: boolean }) {
    setPending(true);
    setNotice(null);
    try {
      const result = await apiRequest<StageChangeResult>(`/api/v1/concepts/${conceptId}/progress`, {
        method: "PATCH",
        body: { ...body, source: "USER" },
      });
      if (result.changed) {
        setShown(result.to);
        toast.success(learnCopy.stageMenu.moved(conceptName, STAGE_LABELS[result.to]));
        router.refresh();
      }
    } catch (error) {
      // The only conflict a move to Demonstrated can hit is "no evidence linked yet".
      if (error instanceof ApiError && error.status === 409 && body.stage === "DEMONSTRATED") {
        setNotice({ kind: "needs-evidence" });
      } else {
        setNotice({
          kind: "error",
          text: error instanceof ApiError ? error.message : learnCopy.stageMenu.failed,
        });
      }
    } finally {
      setPending(false);
    }
  }

  function choose(value: string) {
    const next = value as ConceptStage;
    if (next === shown) return;
    if (next === "COMFORTABLE") {
      setConfirmComfortable(true);
      return;
    }
    void move({ stage: next });
  }

  return (
    <div className="flex flex-col items-start gap-1.5 sm:items-end">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            disabled={pending}
            aria-busy={pending}
            aria-label={learnCopy.stageMenu.triggerLabel(conceptName, STAGE_LABELS[shown])}
            className="focus-visible:ring-ring/50 inline-flex items-center gap-1 rounded-full outline-none focus-visible:ring-3 disabled:opacity-70"
          >
            <StageBadge stage={shown} />
            {pending ? (
              <Loader2 className="text-muted-foreground size-3.5 animate-spin" aria-hidden />
            ) : (
              <ChevronDown className="text-muted-foreground size-3.5" aria-hidden />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-72">
          <DropdownMenuRadioGroup value={shown} onValueChange={choose}>
            {STAGES.map((option) => (
              <DropdownMenuRadioItem key={option} value={option} className="items-start py-1.5">
                <span className="flex flex-col gap-0.5">
                  <span className="font-medium">{STAGE_LABELS[option]}</span>
                  <span className="text-muted-foreground text-xs">
                    {STAGE_DESCRIPTIONS[option]}
                  </span>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>

      <div aria-live="polite" className="max-w-xs text-sm">
        {notice?.kind === "needs-evidence" && (
          <p role="alert" className="text-muted-foreground sm:text-right">
            <span className="text-foreground font-medium">
              {learnCopy.stageMenu.needsEvidence.title}.
            </span>{" "}
            {learnCopy.stageMenu.needsEvidence.body}{" "}
            <Link
              href={`/evidence/new?conceptId=${conceptId}`}
              className="text-foreground font-medium underline underline-offset-4"
            >
              {learnCopy.stageMenu.needsEvidence.action}
            </Link>
          </p>
        )}
        {notice?.kind === "error" && (
          <p role="alert" className="text-destructive sm:text-right">
            {notice.text}
          </p>
        )}
      </div>

      <AlertDialog open={confirmComfortable} onOpenChange={setConfirmComfortable}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{learnCopy.stageMenu.confirmComfortable.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {learnCopy.stageMenu.confirmComfortable.body}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{learnCopy.stageMenu.confirmComfortable.cancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void move({ stage: "COMFORTABLE", selfAttest: true })}
            >
              {learnCopy.stageMenu.confirmComfortable.confirm}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
