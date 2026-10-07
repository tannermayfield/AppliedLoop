"use client";

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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { api } from "./api";

interface SetAsideCopy {
  setAside: string;
  setAsideTitle: string;
  setAsideBody: string;
  cancel: string;
}

/** Leave an unfinished session without finishing it: `POST /sessions/:id/abandon`. */
export function SetAsideSessionButton({
  sessionId,
  copy,
}: {
  sessionId: string;
  copy: SetAsideCopy;
}) {
  const router = useRouter();

  async function setAside() {
    const result = await api(`/api/v1/sessions/${sessionId}/abandon`, { body: {} });
    if (!result.ok) return toast.error(result.message);
    router.refresh();
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger asChild>
        <Button variant="ghost">{copy.setAside}</Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{copy.setAsideTitle}</AlertDialogTitle>
          <AlertDialogDescription>{copy.setAsideBody}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{copy.cancel}</AlertDialogCancel>
          <AlertDialogAction onClick={setAside}>{copy.setAside}</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
