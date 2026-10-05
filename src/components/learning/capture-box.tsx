"use client";

import { useRef, useState, type FormEvent } from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { AI_FALLBACK_CODES, captureCopy } from "@/lib/copy-capture";
import { requestCopy } from "@/lib/copy-learning";
import { ApiError, apiRequest } from "./api-client";
import { CandidateReview } from "./capture/candidate-review";
import { ManualForm } from "./capture/manual-form";
import { toDrafts, type CandidateDraft, type RawCandidate } from "./capture/state";
import { NativeSelect } from "./native-select";
import type { SkillOption } from "./skill-picker";

const MAX_CHARS = 4000;

type Phase =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "review"; drafts: CandidateDraft[]; sourceId: string | null }
  | { kind: "none" }
  /** AI is off, down or rate limited: say so and offer manual entry. */
  | { kind: "unavailable"; message: string | null };

/**
 * Quick capture for Learn. The student types what they learned; we propose concepts; they confirm
 * or correct them in one click. Nothing is saved before they confirm, and when AI is unavailable
 * the manual single-concept form takes over (AT-03).
 */
export function CaptureBox({ sources }: { sources: { id: string; title: string }[] }) {
  const textArea = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState("");
  const [sourceId, setSourceId] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [problem, setProblem] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [catalog, setCatalog] = useState<SkillOption[]>([]);

  const loading = phase.kind === "loading";
  const reviewing = phase.kind === "review";
  const used = text.trim().length;

  async function loadCatalog() {
    if (catalog.length > 0) return;
    try {
      setCatalog(await apiRequest<SkillOption[]>("/api/v1/skills"));
    } catch {
      // Skill names are a nicety: without them the chips just say "Skills".
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) {
      setProblem(captureCopy.textRequired);
      textArea.current?.focus();
      return;
    }
    if (trimmed.length > MAX_CHARS) {
      setProblem(captureCopy.tooLong(MAX_CHARS));
      textArea.current?.focus();
      return;
    }

    setProblem(null);
    setPhase({ kind: "loading" });
    try {
      const result = await apiRequest<{ candidates: RawCandidate[] }>("/api/v1/concepts/capture", {
        method: "POST",
        body: { text: trimmed, ...(sourceId ? { learningSourceId: sourceId } : {}) },
      });
      if (result.candidates.length === 0) {
        setPhase({ kind: "none" });
        return;
      }
      void loadCatalog();
      setPhase({
        kind: "review",
        drafts: toDrafts(result.candidates),
        sourceId: sourceId || null,
      });
    } catch (error) {
      if (error instanceof ApiError && AI_FALLBACK_CODES.includes(error.code)) {
        setPhase({
          kind: "unavailable",
          message: error.code === "RATE_LIMITED" ? error.message : null,
        });
        setManualOpen(true);
      } else {
        setPhase({ kind: "idle" });
        setProblem(
          error instanceof ApiError
            ? (error.fieldErrors().text ?? error.message)
            : requestCopy.unexpected,
        );
        textArea.current?.focus();
      }
    }
  }

  function reset(options: { clearText: boolean }) {
    setPhase({ kind: "idle" });
    setProblem(null);
    if (options.clearText) setText("");
    textArea.current?.focus();
  }

  return (
    <section
      aria-label={captureCopy.label}
      className="bg-card space-y-4 rounded-2xl border p-4 sm:p-5"
    >
      <form onSubmit={submit} className="space-y-3" noValidate>
        <Label htmlFor="capture-name" className="font-display text-xl font-semibold">
          {captureCopy.label}
        </Label>

        <Textarea
          ref={textArea}
          id="capture-name"
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setProblem(null);
          }}
          placeholder={captureCopy.placeholder}
          rows={3}
          disabled={loading || reviewing}
          aria-invalid={problem !== null}
          aria-describedby="capture-hint capture-problem"
          className="min-h-24"
        />

        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="grid gap-1.5 sm:w-64">
            <Label htmlFor="capture-source">{captureCopy.sourceLabel}</Label>
            <NativeSelect
              id="capture-source"
              value={sourceId}
              onChange={(event) => setSourceId(event.target.value)}
              disabled={loading || reviewing}
              className="h-10 sm:h-9"
            >
              <option value="">
                {sources.length === 0 ? captureCopy.noSourcesYet : captureCopy.noSource}
              </option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.title}
                </option>
              ))}
            </NativeSelect>
          </div>
          <Button type="submit" disabled={loading || reviewing} className="h-10 px-4 sm:h-9">
            {loading ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkles aria-hidden />}
            {loading ? captureCopy.submitting : captureCopy.submit}
          </Button>
        </div>

        <p id="capture-hint" className="text-muted-foreground text-xs">
          {captureCopy.hint}
          {used > MAX_CHARS * 0.8 && (
            <span className={used > MAX_CHARS ? "text-destructive" : undefined}>
              {" "}
              {captureCopy.counter(used, MAX_CHARS)}
            </span>
          )}
        </p>

        <div id="capture-problem" aria-live="polite" className="min-h-5 text-sm">
          {problem && (
            <p role="alert" className="text-destructive">
              {problem}
            </p>
          )}
        </div>
      </form>

      {loading && (
        <div aria-busy="true" className="space-y-2" data-testid="capture-skeleton">
          <p role="status" className="text-muted-foreground text-sm">
            {captureCopy.loading.status}
          </p>
          {[0, 1, 2].map((row) => (
            <Skeleton key={row} className="h-14 w-full rounded-xl motion-reduce:animate-none" />
          ))}
        </div>
      )}

      {phase.kind === "review" && (
        <CandidateReview
          drafts={phase.drafts}
          onChange={(drafts) => setPhase({ ...phase, drafts })}
          catalog={catalog}
          sourceId={phase.sourceId}
          onCancel={() => reset({ clearText: false })}
          onConfirmed={() => reset({ clearText: true })}
        />
      )}

      {phase.kind === "none" && (
        <Alert>
          <AlertTitle>{captureCopy.none.title}</AlertTitle>
          <AlertDescription>{captureCopy.none.body}</AlertDescription>
        </Alert>
      )}

      {phase.kind === "unavailable" && (
        <Alert>
          <AlertTitle>{captureCopy.unavailable.title}</AlertTitle>
          <AlertDescription>{phase.message ?? captureCopy.unavailable.body}</AlertDescription>
        </Alert>
      )}

      {!reviewing && !loading && (
        <div className="space-y-3">
          {!manualOpen && (
            <Button
              type="button"
              variant="link"
              className="h-auto p-0"
              onClick={() => setManualOpen(true)}
            >
              {captureCopy.manual.toggle}
            </Button>
          )}
          {manualOpen && (
            <>
              <ManualForm sources={sources} initialSourceId={sourceId} />
              {phase.kind !== "unavailable" && (
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0"
                  onClick={() => setManualOpen(false)}
                >
                  {captureCopy.manual.hide}
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </section>
  );
}
