"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { Archive, ArchiveRestore, Library, Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SOURCE_TYPES, SOURCE_TYPE_LABELS, learnCopy, requestCopy } from "@/lib/copy-learning";
import type { LearningSourceType } from "@/lib/db/schema/enums";
import { ApiError, apiRequest } from "./api-client";
import { NativeSelect } from "./native-select";

export interface SourceItem {
  id: string;
  type: LearningSourceType;
  title: string;
  code: string | null;
  term: string | null;
  active: boolean;
  conceptCount: number;
}

const copy = learnCopy.sources;

function describe(source: SourceItem): string {
  return [
    SOURCE_TYPE_LABELS[source.type],
    source.code,
    source.term,
    learnCopy.groups.conceptCount(source.conceptCount),
  ]
    .filter(Boolean)
    .join(" · ");
}

function SourceForm({ source, onDone }: { source: SourceItem | null; onDone: () => void }) {
  const [type, setType] = useState<LearningSourceType>(source?.type ?? "COURSE");
  const [title, setTitle] = useState(source?.title ?? "");
  const [code, setCode] = useState(source?.code ?? "");
  const [term, setTerm] = useState(source?.term ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const body = { type, title, code, term };
      const saved = source
        ? await apiRequest<{ title: string }>(`/api/v1/learning-sources/${source.id}`, {
            method: "PATCH",
            body,
          })
        : await apiRequest<{ title: string }>("/api/v1/learning-sources", { method: "POST", body });
      toast.success(copy.saved(saved.title));
      onDone();
    } catch (caught) {
      if (caught instanceof ApiError) {
        setFieldErrors(caught.fieldErrors());
        setError(Object.keys(caught.fieldErrors()).length > 0 ? null : caught.message);
      } else {
        setError(requestCopy.unexpected);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="source-type">{copy.typeLabel}</Label>
        <NativeSelect
          id="source-type"
          value={type}
          onChange={(event) => setType(event.target.value as LearningSourceType)}
        >
          {SOURCE_TYPES.map((option) => (
            <option key={option} value={option}>
              {SOURCE_TYPE_LABELS[option]}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="source-title">{copy.titleLabel}</Label>
        <Input
          id="source-title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder={copy.titlePlaceholder}
          maxLength={120}
          required
          aria-invalid={Boolean(fieldErrors.title)}
          aria-describedby={fieldErrors.title ? "source-title-error" : undefined}
        />
        {fieldErrors.title && (
          <p id="source-title-error" role="alert" className="text-destructive text-sm">
            {fieldErrors.title}
          </p>
        )}
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid gap-1.5">
          <Label htmlFor="source-code">{copy.codeLabel}</Label>
          <Input
            id="source-code"
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder={copy.codePlaceholder}
            maxLength={30}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="source-term">{copy.termLabel}</Label>
          <Input
            id="source-term"
            value={term}
            onChange={(event) => setTerm(event.target.value)}
            placeholder={copy.termPlaceholder}
            maxLength={30}
          />
        </div>
      </div>

      <div aria-live="polite">
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </div>

      <DialogFooter>
        <DialogClose asChild>
          <Button type="button" variant="outline">
            {copy.cancel}
          </Button>
        </DialogClose>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {source ? (pending ? copy.saving : copy.save) : pending ? copy.creating : copy.create}
        </Button>
      </DialogFooter>
    </form>
  );
}

/** Learning sources: add, edit, archive and restore. Archiving never touches the concepts. */
export function SourcesPanel({ sources }: { sources: SourceItem[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<SourceItem | "new" | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const active = sources.filter((source) => source.active);
  const archived = sources.filter((source) => !source.active);

  async function setActive(source: SourceItem, next: boolean) {
    setBusyId(source.id);
    setError(null);
    try {
      await apiRequest(`/api/v1/learning-sources/${source.id}`, {
        method: "PATCH",
        body: { active: next },
      });
      toast.success(next ? copy.restored(source.title) : copy.archived(source.title));
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : requestCopy.unexpected);
    } finally {
      setBusyId(null);
    }
  }

  function renderRow(source: SourceItem) {
    const busy = busyId === source.id;
    return (
      <li
        key={source.id}
        className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
      >
        <div className="min-w-0">
          <p className="font-medium text-pretty">{source.title}</p>
          <p className="text-muted-foreground text-sm">{describe(source)}</p>
        </div>
        <div className="flex shrink-0 gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setEditing(source)}
            aria-label={copy.editLabel(source.title)}
          >
            <Pencil aria-hidden />
            {copy.edit}
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void setActive(source, !source.active)}
            aria-label={
              source.active ? copy.archiveLabel(source.title) : copy.restoreLabel(source.title)
            }
          >
            {busy ? (
              <Loader2 className="animate-spin" aria-hidden />
            ) : source.active ? (
              <Archive aria-hidden />
            ) : (
              <ArchiveRestore aria-hidden />
            )}
            {source.active ? copy.archive : copy.restore}
          </Button>
        </div>
      </li>
    );
  }

  return (
    <section aria-labelledby="sources-heading" id="sources" className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-1">
          <h2 id="sources-heading" className="font-display text-2xl font-semibold">
            {copy.title}
          </h2>
          <p className="text-muted-foreground max-w-2xl text-sm text-pretty">{copy.description}</p>
        </div>
        {sources.length > 0 && (
          <Button type="button" variant="outline" onClick={() => setEditing("new")}>
            <Plus aria-hidden />
            {copy.add}
          </Button>
        )}
      </div>

      <div aria-live="polite">
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </div>

      {sources.length === 0 ? (
        <EmptyState
          icon={Library}
          title={copy.empty.title}
          description={copy.empty.description}
          action={
            <Button type="button" onClick={() => setEditing("new")}>
              <Plus aria-hidden />
              {copy.empty.action}
            </Button>
          }
        />
      ) : (
        <div className="bg-card rounded-2xl border px-4 py-2 sm:px-5">
          {active.length > 0 && <ul className="divide-y">{active.map(renderRow)}</ul>}
          {archived.length > 0 && (
            <div className={active.length > 0 ? "mt-2 border-t pt-3" : "pt-1"}>
              <h3 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
                {copy.archivedHeading}
              </h3>
              <ul className="divide-y">{archived.map(renderRow)}</ul>
            </div>
          )}
        </div>
      )}

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {editing === "new" ? copy.dialogAddTitle : copy.dialogEditTitle}
            </DialogTitle>
            <DialogDescription>{copy.dialogDescription}</DialogDescription>
          </DialogHeader>
          {editing && (
            <SourceForm
              key={editing === "new" ? "new" : editing.id}
              source={editing === "new" ? null : editing}
              onDone={() => {
                setEditing(null);
                router.refresh();
              }}
            />
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
