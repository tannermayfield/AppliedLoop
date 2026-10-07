// Autosave for the Build session notes, as a small framework-free object so the rules can be tested:
//
//   - typing is saved after a short pause (debounce);
//   - only one save is ever in flight, so two requests can never land out of order;
//   - `flush()` saves whatever is still unsaved RIGHT NOW and resolves when it is safe. "Finish &
//     Extract" awaits it, so notes typed a moment before it are never lost (audit F-17: the old
//     editor cancelled its pending save when the page unmounted, and a slow save could land after
//     the session was completed and be refused).

export const NOTES_SAVE_DELAY_MS = 800;

export type SaveState = "idle" | "saving" | "saved" | "failed";

/**
 * What one save attempt came to. `ended` means the session is no longer active (the server answers
 * 409), so there is nowhere left to save to and retrying cannot help.
 */
export type SaveOutcome = "saved" | "failed" | "ended";

export interface NotesSaver {
  /** The student typed: remember it and save after a pause. */
  change(value: string): void;
  /**
   * Save anything unsaved now and wait for it (and for a save already in flight). Resolves `true`
   * when nothing is left unsaved, or when the session has ended and nothing can be; `false` when a
   * save failed and the text is still only in the browser.
   */
  flush(): Promise<boolean>;
  state(): SaveState;
  /** `useSyncExternalStore`-compatible. */
  subscribe(listener: () => void): () => void;
}

export function createNotesSaver(options: {
  initial: string;
  save: (notes: string) => Promise<SaveOutcome>;
  delayMs?: number;
}): NotesSaver {
  const { save, delayMs = NOTES_SAVE_DELAY_MS } = options;
  let persisted = options.initial; // what the server has
  let latest = options.initial; // what the student has typed
  let current: SaveState = "idle";
  let timer: ReturnType<typeof setTimeout> | null = null;
  // `draining` is set and cleared INSIDE the loop, never from the code that starts it: a loop with
  // nothing to save finishes synchronously, and clearing a flag from the outside would then happen
  // before it was set, leaving it stuck on (the first version of this file did exactly that, and
  // the React strict-mode cleanup `flush()` was enough to trigger it).
  let draining = false;
  let loop: Promise<boolean> = Promise.resolve(true);
  const listeners = new Set<() => void>();

  const setState = (next: SaveState) => {
    if (current === next) return;
    current = next;
    for (const listener of [...listeners]) listener();
  };
  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  // One loop at a time. After each save it looks at `latest` again, so text typed meanwhile is
  // picked up by the same loop, and everyone who waits on it waits for ALL of it.
  function drain(): Promise<boolean> {
    if (draining) return loop;
    draining = true;
    loop = (async () => {
      try {
        while (latest !== persisted) {
          const value = latest;
          setState("saving");
          let outcome: SaveOutcome;
          try {
            outcome = await save(value);
          } catch {
            outcome = "failed";
          }
          if (outcome === "failed") {
            setState("failed");
            return false;
          }
          persisted = value; // for "ended" too: there is nothing more to try
          setState(outcome === "saved" ? "saved" : "failed");
        }
        return true;
      } finally {
        draining = false;
      }
    })();
    return loop;
  }

  return {
    change(value) {
      latest = value;
      clearTimer();
      if (value === persisted) return;
      timer = setTimeout(() => {
        timer = null;
        void drain();
      }, delayMs);
    },
    flush() {
      clearTimer();
      return drain();
    },
    state: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
