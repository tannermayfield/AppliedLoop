"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { learnCopy, requestCopy } from "@/lib/copy-learning";
import { ApiError, apiRequest } from "./api-client";
import { NativeSelect } from "./native-select";

interface Props {
  concept: {
    id: string;
    name: string;
    description: string;
    notes: string;
    learningSourceId: string | null;
  };
  /** Every source of the student, archived ones included (the concept may still point at one). */
  sources: { id: string; title: string; active: boolean }[];
}

const copy = learnCopy.concept;

interface Values {
  name: string;
  description: string;
  notes: string;
  sourceId: string;
}

/** Name, description, notes and source of one concept. Saves only what changed. */
export function ConceptEditor({ concept, sources }: Props) {
  const router = useRouter();
  const initial: Values = {
    name: concept.name,
    description: concept.description,
    notes: concept.notes,
    sourceId: concept.learningSourceId ?? "",
  };
  const [baseline, setBaseline] = useState(initial);
  const [values, setValues] = useState(initial);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<
    { kind: "saved" } | { kind: "error"; text: string; existingConceptId?: string } | null
  >(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const dirty =
    values.name !== baseline.name ||
    values.description !== baseline.description ||
    values.notes !== baseline.notes ||
    values.sourceId !== baseline.sourceId;

  const set = (patch: Partial<Values>) => {
    setValues((current) => ({ ...current, ...patch }));
    setMessage(null);
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dirty) return;

    const body: Record<string, unknown> = {};
    if (values.name !== baseline.name) body.name = values.name;
    if (values.description !== baseline.description) body.description = values.description;
    if (values.notes !== baseline.notes) body.notes = values.notes;
    if (values.sourceId !== baseline.sourceId) body.learningSourceId = values.sourceId || null;

    setPending(true);
    setMessage(null);
    setFieldErrors({});
    try {
      await apiRequest(`/api/v1/concepts/${concept.id}`, { method: "PATCH", body });
      setBaseline(values);
      setMessage({ kind: "saved" });
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) {
        const fields = caught.fieldErrors();
        setFieldErrors(fields);
        setMessage({
          kind: "error",
          text: Object.keys(fields).length > 0 ? "" : caught.message,
          existingConceptId:
            caught.code === "CONFLICT"
              ? (caught.details as { existingConceptId?: string } | null)?.existingConceptId
              : undefined,
        });
      } else {
        setMessage({ kind: "error", text: requestCopy.unexpected });
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="concept-name">{copy.nameLabel}</Label>
        <Input
          id="concept-name"
          value={values.name}
          onChange={(event) => set({ name: event.target.value })}
          maxLength={120}
          required
          aria-invalid={Boolean(fieldErrors.name)}
          aria-describedby={fieldErrors.name ? "concept-name-error" : undefined}
        />
        {fieldErrors.name && (
          <p id="concept-name-error" role="alert" className="text-destructive text-sm">
            {fieldErrors.name}
          </p>
        )}
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="concept-description">{copy.descriptionLabel}</Label>
        <Textarea
          id="concept-description"
          value={values.description}
          onChange={(event) => set({ description: event.target.value })}
          placeholder={copy.descriptionPlaceholder}
          maxLength={1000}
          rows={2}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="concept-notes">{copy.notesLabel}</Label>
        <Textarea
          id="concept-notes"
          value={values.notes}
          onChange={(event) => set({ notes: event.target.value })}
          placeholder={copy.notesPlaceholder}
          maxLength={5000}
          rows={5}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="concept-source">{copy.sourceLabel}</Label>
        <NativeSelect
          id="concept-source"
          value={values.sourceId}
          onChange={(event) => set({ sourceId: event.target.value })}
        >
          <option value="">{copy.noSource}</option>
          {sources.map((source) => (
            <option key={source.id} value={source.id}>
              {source.title}
              {source.active ? "" : " (archived)"}
            </option>
          ))}
        </NativeSelect>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending || !dirty}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {pending ? copy.saving : copy.save}
        </Button>
        <div aria-live="polite" className="text-sm">
          {message?.kind === "saved" && <p className="text-success">{copy.saved}</p>}
          {message?.kind === "error" && message.text && (
            <p role="alert" className="text-destructive">
              {message.text}{" "}
              {message.existingConceptId && (
                <Link
                  href={`/learn/concepts/${message.existingConceptId}`}
                  className="text-foreground font-medium underline underline-offset-4"
                >
                  {learnCopy.capture.viewExisting}
                </Link>
              )}
            </p>
          )}
        </div>
      </div>
    </form>
  );
}
