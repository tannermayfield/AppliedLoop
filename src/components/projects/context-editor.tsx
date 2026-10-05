"use client";

import { useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { History, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, apiRequest } from "@/components/learning/api-client";
import { requestCopy } from "@/lib/copy-learning";
import {
  CONTEXT_FIELDS,
  CONTEXT_FIELD_MAX_CHARS,
  projectsCopy,
  type ContextFieldKey,
} from "@/lib/copy-projects";

/** One saved version, with its date already formatted on the server. */
export interface ContextVersionView {
  id: string;
  version: number;
  createdLabel: string;
  summary: string;
  architecture: string;
  dataModel: string;
  constraints: string;
  decisions: string;
}

interface Props {
  projectId: string;
  /** Every saved version, newest first. */
  versions: ContextVersionView[];
}

type Values = Record<ContextFieldKey, string>;

const copy = projectsCopy.context;
const EMPTY: Values = {
  summary: "",
  architecture: "",
  dataModel: "",
  constraints: "",
  decisions: "",
};

function valuesOf(version: ContextVersionView | undefined): Values {
  if (!version) return EMPTY;
  return {
    summary: version.summary,
    architecture: version.architecture,
    dataModel: version.dataModel,
    constraints: version.constraints,
    decisions: version.decisions,
  };
}

/** The five context fields. Every save is a new version; earlier versions are listed below. */
export function ContextEditor({ projectId, versions }: Props) {
  const router = useRouter();
  const firstField = useRef<HTMLTextAreaElement>(null);
  const latest = versions[0];
  const [baseline, setBaseline] = useState<Values>(valuesOf(latest));
  const [values, setValues] = useState<Values>(valuesOf(latest));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<{ kind: "info" | "saved" | "error"; text: string } | null>(
    null,
  );

  const dirty = CONTEXT_FIELDS.some((field) => values[field.key] !== baseline[field.key]);

  function edit(key: ContextFieldKey, text: string) {
    setValues((current) => ({ ...current, [key]: text }));
    setMessage(null);
  }

  function loadVersion(version: ContextVersionView) {
    setValues(valuesOf(version));
    setMessage({ kind: "info", text: copy.loadedVersion(version.version) });
    firstField.current?.focus();
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dirty) return;
    setPending(true);
    setMessage(null);
    try {
      const saved = await apiRequest<{ version: number }>(`/api/v1/projects/${projectId}/context`, {
        method: "PUT",
        body: values,
      });
      setBaseline(values);
      setMessage({ kind: "saved", text: copy.saved(saved.version) });
      router.refresh();
    } catch (caught) {
      setMessage({
        kind: "error",
        text: caught instanceof ApiError ? caught.message : requestCopy.unexpected,
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="context-heading"
      className="bg-card space-y-5 rounded-2xl border p-4 sm:p-5"
    >
      <div className="space-y-1">
        <h2 id="context-heading" className="font-display text-xl font-semibold">
          {copy.heading}
        </h2>
        <p className="text-muted-foreground text-sm text-pretty">{copy.description}</p>
        {versions.length === 0 && <p className="text-muted-foreground text-sm">{copy.empty}</p>}
      </div>

      <form onSubmit={save} className="grid gap-4">
        {CONTEXT_FIELDS.map((field, index) => {
          const used = values[field.key].length;
          return (
            <div key={field.key} className="grid gap-1.5">
              <Label htmlFor={`context-${field.key}`}>{field.label}</Label>
              <Textarea
                ref={index === 0 ? firstField : undefined}
                id={`context-${field.key}`}
                value={values[field.key]}
                onChange={(event) => edit(field.key, event.target.value)}
                placeholder={field.placeholder}
                maxLength={CONTEXT_FIELD_MAX_CHARS}
                rows={3}
                aria-describedby={`context-${field.key}-hint`}
              />
              <p
                id={`context-${field.key}-hint`}
                className="text-muted-foreground flex justify-between gap-3 text-xs"
              >
                <span>{field.hint}</span>
                {used > CONTEXT_FIELD_MAX_CHARS * 0.8 && (
                  <span>{copy.count(used, CONTEXT_FIELD_MAX_CHARS)}</span>
                )}
              </p>
            </div>
          );
        })}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={pending || !dirty}>
            {pending && <Loader2 className="animate-spin" aria-hidden />}
            {pending ? copy.saving : copy.save}
          </Button>
          <div aria-live="polite" className="text-sm">
            {message?.kind === "saved" && <p className="text-success">{message.text}</p>}
            {message?.kind === "info" && <p className="text-muted-foreground">{message.text}</p>}
            {message?.kind === "error" && (
              <p role="alert" className="text-destructive">
                {message.text}
              </p>
            )}
          </div>
        </div>
      </form>

      <div className="border-t pt-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-medium">
          <History className="size-4" aria-hidden />
          {copy.versionsHeading}
        </h3>
        {versions.length === 0 ? (
          <p className="text-muted-foreground text-sm">{copy.versionsEmpty}</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {versions.map((version, index) => (
              <li key={version.id}>
                <details className="group px-3 py-2">
                  <summary className="focus-visible:ring-ring/50 flex cursor-pointer list-none items-center justify-between gap-3 rounded-sm text-sm outline-none focus-visible:ring-3">
                    <span className="font-medium">
                      {copy.version(version.version)}
                      {index === 0 && (
                        <span className="bg-secondary text-secondary-foreground ml-2 rounded-full px-2 py-0.5 text-xs font-normal">
                          {copy.latest}
                        </span>
                      )}
                    </span>
                    <span className="text-muted-foreground">
                      {copy.savedOn(version.createdLabel)}
                    </span>
                  </summary>
                  <dl className="mt-3 grid gap-3">
                    {CONTEXT_FIELDS.map((field) => (
                      <div key={field.key} className="grid gap-0.5">
                        <dt className="text-muted-foreground text-xs font-medium">{field.label}</dt>
                        <dd className="text-sm whitespace-pre-wrap">
                          {version[field.key] || (
                            <span className="text-muted-foreground">{copy.emptyField}</span>
                          )}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  {index > 0 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => loadVersion(version)}
                      aria-label={copy.useVersionLabel(version.version)}
                    >
                      {copy.useVersion}
                    </Button>
                  )}
                </details>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
