"use client";

import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { APPLY_COPY } from "@/lib/copy-sessions";
import { api } from "./api";

const t = APPLY_COPY.session;

/** Hard delete, so the student controls retention of pasted code (SPEC_REVIEW R-12). */
export function DeleteSessionButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();

  async function remove() {
    const result = await api(`/api/v1/sessions/${sessionId}`, { method: "DELETE" });
    if (!result.ok) return toast.error(result.message);
    router.push("/today");
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost" size="sm" className="text-destructive">
          <Trash2 aria-hidden /> {t.delete}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t.deleteTitle}</AlertDialogTitle>
          <AlertDialogDescription>{t.deleteBody}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t.cancel}</AlertDialogCancel>
          <AlertDialogAction variant="destructive" onClick={remove}>
            {t.delete}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
