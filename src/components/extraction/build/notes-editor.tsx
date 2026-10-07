"use client";

import { useCallback, useId, useState, useSyncExternalStore } from "react";
import { Textarea } from "@/components/ui/textarea";
import { BUILD_COPY } from "@/lib/copy-build";
import { SESSION_LIMITS } from "@/lib/copy-sessions";
import { useNotesSaver } from "./notes-saver-context";

const t = BUILD_COPY.session;

/**
 * Session notes with a debounced autosave (PATCH /api/v1/sessions/:id/notes). The saving itself
 * lives in the shared notes saver, so "Finish & Extract" can flush it first (audit F-17). Rendered
 * inside a `NotesSaverProvider`.
 */
export function NotesEditor({ initial }: { initial: string }) {
  const id = useId();
  const saver = useNotesSaver();
  const [notes, setNotes] = useState(initial);
  const subscribe = useCallback(
    (listener: () => void) => saver?.subscribe(listener) ?? (() => undefined),
    [saver],
  );
  const state = useSyncExternalStore(
    subscribe,
    () => saver?.state() ?? "idle",
    () => "idle",
  );

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
        onChange={(event) => {
          setNotes(event.target.value);
          saver?.change(event.target.value);
        }}
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
