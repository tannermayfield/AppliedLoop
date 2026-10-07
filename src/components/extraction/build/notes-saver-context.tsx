"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { api } from "@/components/sessions/api";
import { createNotesSaver, type NotesSaver } from "./notes-saver";

const NotesSaverContext = createContext<NotesSaver | null>(null);

/**
 * Owns the notes autosave for one Build session and shares it with the notes editor and the
 * Finish & Extract form, so the form can wait for the notes to be saved before it finishes the
 * session. The children are server-rendered; only this wrapper is a client component.
 */
export function NotesSaverProvider({
  sessionId,
  initial,
  children,
}: {
  sessionId: string;
  initial: string;
  children: React.ReactNode;
}) {
  const [saver] = useState(() =>
    createNotesSaver({
      initial,
      save: async (notes) => {
        const result = await api(`/api/v1/sessions/${sessionId}/notes`, {
          method: "PATCH",
          body: { notes },
        });
        if (result.ok) return "saved";
        // 409: the session is no longer active (finished or set aside somewhere else).
        return result.status === 409 ? "ended" : "failed";
      },
    }),
  );

  // Leaving the page must not drop text that is still waiting for its autosave.
  useEffect(
    () => () => {
      void saver.flush();
    },
    [saver],
  );

  return <NotesSaverContext.Provider value={saver}>{children}</NotesSaverContext.Provider>;
}

/** The session's notes saver, or null outside a `NotesSaverProvider`. */
export function useNotesSaver(): NotesSaver | null {
  return useContext(NotesSaverContext);
}
