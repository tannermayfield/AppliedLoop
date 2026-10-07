import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  NOTES_SAVE_DELAY_MS,
  createNotesSaver,
  type SaveOutcome,
} from "@/components/extraction/build/notes-saver";

// Audit F-17: notes typed just before "Finish & Extract" were lost. The old editor cancelled its
// pending save on unmount, and a slow save could land after the session was completed (409).

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("createNotesSaver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("saves once after a pause, with the latest text", async () => {
    const save = vi.fn(async (): Promise<SaveOutcome> => "saved");
    const saver = createNotesSaver({ initial: "", save });

    saver.change("a");
    saver.change("ab");
    await vi.advanceTimersByTimeAsync(NOTES_SAVE_DELAY_MS - 1);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("ab");
    expect(saver.state()).toBe("saved");
  });

  it("flush saves the text typed a moment ago immediately, and the cancelled timer saves nothing more", async () => {
    const save = vi.fn(async (): Promise<SaveOutcome> => "saved");
    const saver = createNotesSaver({ initial: "", save });

    saver.change("typed just before Finish");
    // No time passes: this is the click on "Finish & Extract".
    await expect(saver.flush()).resolves.toBe(true);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("typed just before Finish");
    await vi.advanceTimersByTimeAsync(NOTES_SAVE_DELAY_MS * 5);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("flush waits for a save already in flight, then saves what was typed meanwhile, in order", async () => {
    const first = deferred<SaveOutcome>();
    const save = vi
      .fn<(notes: string) => Promise<SaveOutcome>>()
      .mockImplementationOnce(() => first.promise)
      .mockImplementation(async () => "saved");
    const saver = createNotesSaver({ initial: "", save });

    saver.change("one");
    await vi.advanceTimersByTimeAsync(NOTES_SAVE_DELAY_MS); // the first save is now on the wire
    expect(save).toHaveBeenCalledTimes(1);

    saver.change("one two");
    let flushed: boolean | undefined;
    const flushing = saver.flush().then((ok) => {
      flushed = ok;
    });
    await vi.advanceTimersByTimeAsync(NOTES_SAVE_DELAY_MS * 5);
    // One request at a time: the newer text waits for the first to land, so they cannot cross.
    expect(save).toHaveBeenCalledTimes(1);
    expect(flushed).toBeUndefined();

    first.resolve("saved");
    await flushing;
    expect(save.mock.calls.map(([notes]) => notes)).toEqual(["one", "one two"]);
    expect(flushed).toBe(true);
  });

  it("flush with nothing unsaved asks for nothing", async () => {
    const save = vi.fn(async (): Promise<SaveOutcome> => "saved");
    const saver = createNotesSaver({ initial: "already saved", save });

    await expect(saver.flush()).resolves.toBe(true);
    saver.change("already saved");
    await expect(saver.flush()).resolves.toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  // The bug the browser found: React's strict-mode cleanup flushes an editor that has nothing to
  // save. That loop finishes synchronously, and a "running" flag cleared from outside the loop was
  // then left stuck on, so nothing typed afterwards was ever saved.
  it("an empty flush does not stop later typing from being saved", async () => {
    const save = vi.fn(async (): Promise<SaveOutcome> => "saved");
    const saver = createNotesSaver({ initial: "", save });

    await expect(saver.flush()).resolves.toBe(true); // nothing to save yet
    saver.change("typed afterwards");
    await vi.advanceTimersByTimeAsync(NOTES_SAVE_DELAY_MS);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("typed afterwards");
    expect(saver.state()).toBe("saved");
  });

  it("flushes called back to back with typing in between never miss the newer text", async () => {
    const save = vi.fn(async (): Promise<SaveOutcome> => "saved");
    const saver = createNotesSaver({ initial: "", save });

    const first = saver.flush(); // nothing to save: finishes at once
    saver.change("a");
    const second = saver.flush();
    await expect(Promise.all([first, second])).resolves.toEqual([true, true]);

    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("a");
  });

  it("typing back to the saved text cancels the pending save", async () => {
    const save = vi.fn(async (): Promise<SaveOutcome> => "saved");
    const saver = createNotesSaver({ initial: "", save });

    saver.change("x");
    saver.change("");
    await vi.advanceTimersByTimeAsync(NOTES_SAVE_DELAY_MS * 2);
    expect(save).not.toHaveBeenCalled();
  });

  it("a failed save makes flush say so (Finish must not go ahead) and a later flush or keystroke retries", async () => {
    const save = vi
      .fn<(notes: string) => Promise<SaveOutcome>>()
      .mockResolvedValueOnce("failed")
      .mockResolvedValueOnce("failed")
      .mockResolvedValue("saved");
    const saver = createNotesSaver({ initial: "", save });

    saver.change("keep this");
    await expect(saver.flush()).resolves.toBe(false);
    expect(saver.state()).toBe("failed");

    await expect(saver.flush()).resolves.toBe(false); // the same text is still unsaved
    expect(save).toHaveBeenCalledTimes(2);

    saver.change("keep this text");
    await vi.advanceTimersByTimeAsync(NOTES_SAVE_DELAY_MS);
    expect(save).toHaveBeenLastCalledWith("keep this text");
    expect(saver.state()).toBe("saved");
    await expect(saver.flush()).resolves.toBe(true);
  });

  it("treats a thrown error like a failed save", async () => {
    const save = vi.fn(async (): Promise<SaveOutcome> => {
      throw new Error("boom");
    });
    const saver = createNotesSaver({ initial: "", save });
    saver.change("x");
    await expect(saver.flush()).resolves.toBe(false);
    expect(saver.state()).toBe("failed");
  });

  it("when the session has already ended there is nowhere to save: flush does not block and does not retry", async () => {
    const save = vi.fn(async (): Promise<SaveOutcome> => "ended");
    const saver = createNotesSaver({ initial: "", save });

    saver.change("too late");
    await expect(saver.flush()).resolves.toBe(true);
    await expect(saver.flush()).resolves.toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("tells subscribers about each state until they unsubscribe", async () => {
    const save = vi.fn(async (): Promise<SaveOutcome> => "saved");
    const saver = createNotesSaver({ initial: "", save });
    const seen: string[] = [];
    const unsubscribe = saver.subscribe(() => seen.push(saver.state()));

    saver.change("a");
    await saver.flush();
    expect(seen).toEqual(["saving", "saved"]);

    unsubscribe();
    saver.change("ab");
    await saver.flush();
    expect(seen).toEqual(["saving", "saved"]);
  });
});
