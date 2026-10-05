"use client";

import { useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { captureCopy } from "@/lib/copy-capture";
import { learnCopy, requestCopy } from "@/lib/copy-learning";
import { ApiError, apiRequest } from "../api-client";
import { NativeSelect } from "../native-select";

type Status =
  | { kind: "added"; text: string }
  | { kind: "duplicate"; text: string; existingConceptId?: string }
  | { kind: "error"; text: string };

interface Props {
  sources: { id: string; title: string }[];
  /** The source chosen in the capture form, so the student does not pick it twice. */
  initialSourceId?: string;
}

/**
 * Add ONE concept by name, no AI involved. This is the fallback when capture is unavailable (AT-03:
 * "AI unavailable → manual capture remains possible") and a quick path when the student already
 * knows the name.
 */
export function ManualForm({ sources, initialSourceId = "" }: Props) {
  const router = useRouter();
  const nameInput = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [sourceId, setSourceId] = useState(initialSourceId);
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = name.trim();
    if (!trimmed) {
      setStatus({ kind: "error", text: learnCopy.capture.needsName });
      nameInput.current?.focus();
      return;
    }

    setPending(true);
    setStatus(null);
    try {
      await apiRequest("/api/v1/concepts", {
        method: "POST",
        body: { name: trimmed, ...(sourceId ? { learningSourceId: sourceId } : {}) },
      });
      setName("");
      setStatus({ kind: "added", text: learnCopy.capture.added(trimmed) });
      router.refresh();
      nameInput.current?.focus();
    } catch (error) {
      if (error instanceof ApiError && error.code === "CONFLICT") {
        const existing = (error.details as { existingConceptId?: string } | null)
          ?.existingConceptId;
        setStatus({
          kind: "duplicate",
          text: learnCopy.capture.duplicate(trimmed),
          existingConceptId: existing,
        });
      } else {
        const fieldMessage = error instanceof ApiError ? error.fieldErrors().name : undefined;
        setStatus({
          kind: "error",
          text:
            fieldMessage ?? (error instanceof ApiError ? error.message : requestCopy.unexpected),
        });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      onSubmit={submit}
      aria-labelledby="capture-manual-heading"
      className="bg-muted/40 space-y-3 rounded-xl border p-3 sm:p-4"
    >
      <h3 id="capture-manual-heading" className="text-sm font-medium">
        {captureCopy.manual.heading}
      </h3>

      <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
        <div className="grid gap-1.5">
          <Label htmlFor="capture-manual-name">{captureCopy.manual.nameLabel}</Label>
          <Input
            ref={nameInput}
            id="capture-manual-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={captureCopy.manual.placeholder}
            maxLength={120}
            autoComplete="off"
            aria-describedby="capture-manual-hint capture-manual-status"
            className="h-10 sm:h-9"
          />
        </div>
        <div className="grid gap-1.5 sm:w-48">
          <Label htmlFor="capture-manual-source">{captureCopy.sourceLabel}</Label>
          <NativeSelect
            id="capture-manual-source"
            value={sourceId}
            onChange={(event) => setSourceId(event.target.value)}
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
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Button type="submit" disabled={pending} className="h-10 px-4 sm:h-9">
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
          {pending ? learnCopy.capture.submitting : learnCopy.capture.submit}
        </Button>
        <p id="capture-manual-hint" className="text-muted-foreground text-xs">
          {captureCopy.manual.hint}
        </p>
      </div>

      <div id="capture-manual-status" aria-live="polite" className="min-h-5 text-sm">
        {status?.kind === "added" && <p className="text-success">{status.text}</p>}
        {status?.kind === "duplicate" && (
          <p className="text-muted-foreground">
            {status.text}{" "}
            {status.existingConceptId && (
              <Link
                href={`/learn/concepts/${status.existingConceptId}`}
                className="text-foreground font-medium underline underline-offset-4"
              >
                {learnCopy.capture.viewExisting}
              </Link>
            )}
          </p>
        )}
        {status?.kind === "error" && (
          <p role="alert" className="text-destructive">
            {status.text}
          </p>
        )}
      </div>
    </form>
  );
}
