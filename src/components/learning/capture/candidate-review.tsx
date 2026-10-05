"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { StageBadge } from "@/components/stage-badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { captureCopy } from "@/lib/copy-capture";
import { requestCopy } from "@/lib/copy-learning";
import { STAGE_LABELS } from "@/lib/copy";
import { ApiError, apiRequest } from "../api-client";
import { NativeSelect } from "../native-select";
import { SkillPicker, type SkillOption } from "../skill-picker";
import {
  buildBulkBody,
  confirmableDrafts,
  firstProblem,
  type CandidateDraft,
  type CaptureStage,
} from "./state";

const copy = captureCopy.review;
const STAGE_CHOICES: CaptureStage[] = ["EXPOSED", "LEARNED"];

interface Props {
  drafts: CandidateDraft[];
  onChange: (drafts: CandidateDraft[]) => void;
  /** Every skill the student can use; empty while loading or if it could not be loaded. */
  catalog: SkillOption[];
  /** The learning source the capture was for, applied to every concept added. */
  sourceId: string | null;
  onCancel: () => void;
  /** Called after the concepts were saved. */
  onConfirmed: () => void;
}

/**
 * The candidates the model found, for the student to confirm. Nothing here is saved until they
 * press a Confirm button: the model suggests, the student decides.
 */
export function CandidateReview({
  drafts,
  onChange,
  catalog,
  sourceId,
  onCancel,
  onConfirmed,
}: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<"all" | "selected" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerKey, setPickerKey] = useState<string | null>(null);
  const nameInputs = useRef(new Map<string, HTMLInputElement>());

  const skillName = new Map(catalog.map((skill) => [skill.id, skill.name]));
  const allCount = confirmableDrafts(drafts, "all").length;
  const selectedCount = confirmableDrafts(drafts, "selected").length;
  const pickerDraft = drafts.find((draft) => draft.key === pickerKey);

  function update(key: string, change: Partial<CandidateDraft>) {
    setError(null);
    onChange(drafts.map((draft) => (draft.key === key ? { ...draft, ...change } : draft)));
  }

  async function confirm(mode: "all" | "selected") {
    const chosen = confirmableDrafts(drafts, mode);
    if (chosen.length === 0) {
      setError(allCount === 0 ? copy.nothingToConfirm : copy.nothingSelected);
      return;
    }
    const problem = firstProblem(chosen);
    if (problem) {
      setEditing(true);
      setError(copy.nameRequired);
      requestAnimationFrame(() => nameInputs.current.get(problem.key)?.focus());
      return;
    }

    setPending(mode);
    setError(null);
    try {
      const result = await apiRequest<{ created: unknown[]; skipped: unknown[] }>(
        "/api/v1/concepts/bulk",
        { method: "POST", body: buildBulkBody(chosen, sourceId) },
      );
      const added = result.created.length;
      const skipped = result.skipped.length;
      if (added === 0) toast.info(copy.allSkipped);
      else toast.success(skipped > 0 ? copy.addedSkipped(added, skipped) : copy.added(added));
      onConfirmed();
      router.refresh();
    } catch (caught) {
      setError(
        caught instanceof ApiError
          ? (Object.values(caught.fieldErrors())[0] ?? caught.message)
          : requestCopy.unexpected,
      );
      setPending(null);
    }
  }

  return (
    <section aria-labelledby="capture-review-heading" className="space-y-4">
      <div className="space-y-1">
        <h3 id="capture-review-heading" className="font-display text-lg font-semibold">
          {copy.heading(drafts.length)}
        </h3>
        <p className="text-muted-foreground text-sm">{copy.intro}</p>
      </div>

      <ul aria-label={copy.listLabel} className="space-y-2">
        {drafts.map((draft, index) => {
          const duplicate = draft.existingConceptId !== null;
          const checkId = `capture-select-${draft.key}`;
          return (
            <li
              key={draft.key}
              className="bg-background flex gap-3 rounded-xl border p-3 data-[duplicate=true]:opacity-80"
              data-duplicate={duplicate}
            >
              <Checkbox
                id={checkId}
                checked={draft.selected}
                disabled={duplicate || pending !== null}
                onCheckedChange={(value) => update(draft.key, { selected: value === true })}
                aria-label={copy.selectLabel(draft.name || copy.nameLabel(index + 1))}
                className="mt-1"
              />
              <div className="min-w-0 flex-1 space-y-2">
                {editing && !duplicate ? (
                  <Input
                    ref={(element) => {
                      if (element) nameInputs.current.set(draft.key, element);
                      else nameInputs.current.delete(draft.key);
                    }}
                    value={draft.name}
                    onChange={(event) => update(draft.key, { name: event.target.value })}
                    aria-label={copy.nameLabel(index + 1)}
                    aria-invalid={draft.name.trim() === ""}
                    maxLength={120}
                    autoComplete="off"
                    disabled={pending !== null}
                    className="h-10 sm:h-9"
                  />
                ) : (
                  <label htmlFor={checkId} className="block cursor-pointer font-medium break-words">
                    {draft.name}
                  </label>
                )}

                {duplicate ? (
                  <p className="text-muted-foreground text-sm">
                    {copy.duplicate}{" "}
                    <Link
                      href={`/learn/concepts/${draft.existingConceptId}`}
                      className="text-foreground font-medium underline underline-offset-4"
                    >
                      {copy.viewExisting}
                    </Link>
                  </p>
                ) : (
                  <>
                    {draft.description && (
                      <p className="text-muted-foreground text-sm text-pretty">
                        {draft.description}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                      <div className="flex items-center gap-2 text-sm">
                        {editing ? (
                          <>
                            <label htmlFor={`stage-${draft.key}`} className="sr-only">
                              {copy.stageLabel(draft.name || copy.nameLabel(index + 1))}
                            </label>
                            <NativeSelect
                              id={`stage-${draft.key}`}
                              value={draft.stage}
                              onChange={(event) =>
                                update(draft.key, { stage: event.target.value as CaptureStage })
                              }
                              disabled={pending !== null}
                              className="h-9 w-36"
                            >
                              {STAGE_CHOICES.map((stage) => (
                                <option key={stage} value={stage}>
                                  {STAGE_LABELS[stage]}
                                </option>
                              ))}
                            </NativeSelect>
                          </>
                        ) : (
                          <>
                            <span className="text-muted-foreground">{copy.startsAs}</span>
                            <StageBadge stage={draft.stage} />
                          </>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="sr-only">{copy.skills}</span>
                        {draft.skillIds.length === 0 && (
                          <span className="text-muted-foreground text-sm">{copy.noSkills}</span>
                        )}
                        {draft.skillIds.map((id) => (
                          <span
                            key={id}
                            className="bg-secondary text-secondary-foreground rounded-full border px-2.5 py-0.5 text-xs"
                          >
                            {skillName.get(id) ?? copy.skills}
                          </span>
                        ))}
                        {editing && catalog.length > 0 && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => setPickerKey(draft.key)}
                            disabled={pending !== null}
                            aria-label={copy.editSkillsFor(draft.name)}
                          >
                            {copy.editSkills}
                          </Button>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {allCount === 0 && <p className="text-muted-foreground text-sm">{copy.nothingToConfirm}</p>}
      {editing && <p className="text-muted-foreground text-xs">{copy.stageHint}</p>}

      <div aria-live="polite" className="min-h-5 text-sm">
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
        <Button
          type="button"
          onClick={() => void confirm("all")}
          disabled={pending !== null || allCount === 0}
          className="h-10 sm:h-9"
        >
          {pending === "all" ? (
            <Loader2 className="animate-spin" aria-hidden />
          ) : (
            <Check aria-hidden />
          )}
          {pending === "all" ? copy.confirming : copy.confirmAll(allCount)}
        </Button>
        {allCount > 1 && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => void confirm("selected")}
            disabled={pending !== null || selectedCount === 0}
            className="h-10 sm:h-9"
          >
            {pending === "selected" && <Loader2 className="animate-spin" aria-hidden />}
            {pending === "selected" ? copy.confirming : copy.confirmSelected(selectedCount)}
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={() => setEditing((value) => !value)}
          disabled={pending !== null}
          aria-pressed={editing}
          className="h-10 sm:h-9"
        >
          <Pencil aria-hidden />
          {editing ? copy.doneEditing : copy.edit}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={onCancel}
          disabled={pending !== null}
          className="h-10 sm:h-9"
        >
          {copy.cancel}
        </Button>
      </div>

      <SkillPicker
        open={pickerDraft !== undefined}
        onOpenChange={(open) => {
          if (!open) setPickerKey(null);
        }}
        title={pickerDraft ? copy.skillsDialogTitle(pickerDraft.name) : undefined}
        catalog={catalog}
        selectedIds={pickerDraft?.skillIds ?? []}
        onConfirm={async (ids) => {
          if (pickerKey) update(pickerKey, { skillIds: ids });
          setPickerKey(null);
        }}
      />
    </section>
  );
}
