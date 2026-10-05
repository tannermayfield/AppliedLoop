"use client";

import { useEffect, useId, useRef, useState } from "react";
import { api } from "@/components/sessions/api";
import { Textarea } from "@/components/ui/textarea";
import { BUILD_COPY } from "@/lib/copy-build";
import { SESSION_LIMITS } from "@/lib/copy-sessions";

const t = BUILD_COPY.session;
const DEBOUNCE_MS = 800;

type SaveState = "idle" | "saving" | "saved" | "failed";

/** Session notes with a debounced autosave (PATCH /api/v1/sessions/:id/notes). */
export function NotesEditor({ sessionId, initial }: { sessionId: string; initial: string }) {
  const id = useId();
  const [notes, setNotes] = useState(initial);
  const [state, setState] = useState<SaveState>("idle");
  const lastSaved = useRef(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (notes === lastSaved.current) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      setState("saving");
      const value = notes;
      const result = await api(`/api/v1/sessions/${sessionId}/notes`, {
        method: "PATCH",
        body: { notes: value },
      });
      if (result.ok) lastSaved.current = value;
      setState(result.ok ? "saved" : "failed");
    }, DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [notes, sessionId]);

  const message =
    state === "saving"
      ? t.notesSaving
      : state === "saved"
        ? t.notesSaved
        : state === "failed"
          ? t.notesFailed
          : "";

  return (
    <section aria-labelledby={`${id}-heading`} className="space-y-2">
      <h2 id={`${id}-heading`} className="font-display text-lg font-semibold">
        {t.notesHeading}
      </h2>
      <label htmlFor={id} className="sr-only">
        {t.notesLabel}
      </label>
      <Textarea
        id={id}
        value={notes}
        maxLength={SESSION_LIMITS.maxNotesChars}
        placeholder={t.notesPlaceholder}
        onChange={(event) => setNotes(event.target.value)}
        className="min-h-28"
      />
      <p
        role="status"
        aria-live="polite"
        className={
          state === "failed" ? "text-destructive text-xs" : "text-muted-foreground text-xs"
        }
      >
        {message}
      </p>
    </section>
  );
}
