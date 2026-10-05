"use client";

import { useMemo, useState } from "react";
import { Loader2, Plus } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import type { SkillDto } from "@/domain/learning/skills";
import { learnCopy, requestCopy } from "@/lib/copy-learning";
import { ApiError, apiRequest } from "./api-client";

export type SkillOption = SkillDto;

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Every skill the student can use (shared catalog plus their own), sorted by category. */
  catalog: SkillOption[];
  /** The skills already chosen; the picker starts from these. */
  selectedIds: string[];
  /**
   * Persist the full chosen set. Throw an `ApiError` to keep the dialog open and show its message;
   * the parent closes the dialog itself after a successful save.
   */
  onConfirm: (ids: string[]) => Promise<void>;
  title?: string;
}

const copy = learnCopy.skillPicker;

function SkillPickerBody({
  catalog,
  selectedIds,
  onConfirm,
}: Pick<Props, "catalog" | "selectedIds" | "onConfirm">) {
  const [extra, setExtra] = useState<SkillOption[]>([]);
  const [chosen, setChosen] = useState(() => new Set(selectedIds));
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const all = useMemo(() => [...catalog, ...extra], [catalog, extra]);
  const query = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      all.filter(
        (skill) =>
          query === "" ||
          skill.name.toLowerCase().includes(query) ||
          skill.category.toLowerCase().includes(query),
      ),
    [all, query],
  );
  const byCategory = useMemo(() => {
    const groups = new Map<string, SkillOption[]>();
    for (const skill of visible)
      groups.set(skill.category, [...(groups.get(skill.category) ?? []), skill]);
    return [...groups];
  }, [visible]);

  const canCreate = query !== "" && !all.some((skill) => skill.name.toLowerCase() === query);

  function toggle(id: string, on: boolean) {
    setChosen((current) => {
      const next = new Set(current);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function createSkill() {
    setCreating(true);
    setError(null);
    setInfo(null);
    try {
      const skill = await apiRequest<SkillOption>("/api/v1/skills", {
        method: "POST",
        body: { name: search.trim() },
      });
      setExtra((current) => [...current, skill]);
      toggle(skill.id, true);
      setSearch("");
    } catch (caught) {
      const existing =
        caught instanceof ApiError && caught.code === "CONFLICT"
          ? (caught.details as { existingSkillId?: string } | null)?.existingSkillId
          : undefined;
      if (existing) {
        // Already in the catalog: select it instead of treating that as a failure.
        toggle(existing, true);
        setSearch("");
        setInfo(copy.alreadyThere);
      } else {
        setError(
          caught instanceof ApiError
            ? (caught.fieldErrors().name ?? caught.message)
            : requestCopy.unexpected,
        );
      }
    } finally {
      setCreating(false);
    }
  }

  async function confirm() {
    setSaving(true);
    setError(null);
    try {
      await onConfirm([...chosen]);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : requestCopy.unexpected);
      setSaving(false);
    }
  }

  return (
    <>
      <div className="grid gap-1.5">
        <Label htmlFor="skill-search">{copy.searchLabel}</Label>
        <Input
          id="skill-search"
          value={search}
          onChange={(event) => {
            setSearch(event.target.value);
            setInfo(null);
          }}
          placeholder={copy.searchPlaceholder}
          autoComplete="off"
          maxLength={60}
        />
      </div>

      <div className="max-h-64 space-y-3 overflow-y-auto rounded-lg border p-3">
        {byCategory.length === 0 && <p className="text-muted-foreground text-sm">{copy.none}</p>}
        {byCategory.map(([category, skills]) => (
          <div key={category} role="group" aria-label={category}>
            <p className="text-muted-foreground mb-1 text-xs font-medium tracking-wide uppercase">
              {category}
            </p>
            <ul>
              {skills.map((skill) => (
                <li key={skill.id} className="flex items-center gap-2.5 py-1.5">
                  <Checkbox
                    id={`skill-${skill.id}`}
                    checked={chosen.has(skill.id)}
                    onCheckedChange={(value) => toggle(skill.id, value === true)}
                  />
                  <Label
                    htmlFor={`skill-${skill.id}`}
                    className="flex-1 cursor-pointer py-0.5 font-normal"
                  >
                    {skill.name}
                    {skill.custom && (
                      <Badge variant="secondary" className="ml-1">
                        {copy.custom}
                      </Badge>
                    )}
                  </Label>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      {canCreate && (
        <Button
          type="button"
          variant="outline"
          disabled={creating}
          onClick={() => void createSkill()}
        >
          {creating ? <Loader2 className="animate-spin" aria-hidden /> : <Plus aria-hidden />}
          {creating ? copy.creating : copy.createLabel(search.trim())}
        </Button>
      )}

      <div aria-live="polite" className="min-h-5 text-sm">
        {info && <p className="text-muted-foreground">{info}</p>}
        {error && (
          <p role="alert" className="text-destructive">
            {error}
          </p>
        )}
      </div>

      <DialogFooter className="items-center sm:justify-between">
        <span className="text-muted-foreground text-sm">{copy.selected(chosen.size)}</span>
        <div className="flex flex-col-reverse gap-2 sm:flex-row">
          <DialogClose asChild>
            <Button type="button" variant="outline">
              {copy.cancel}
            </Button>
          </DialogClose>
          <Button type="button" disabled={saving} onClick={() => void confirm()}>
            {saving && <Loader2 className="animate-spin" aria-hidden />}
            {saving ? copy.saving : copy.confirm}
          </Button>
        </div>
      </DialogFooter>
    </>
  );
}

/** Choose skills from the shared catalog (and the student's own), or add a new one. */
export function SkillPicker({ open, onOpenChange, title, ...body }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title ?? copy.title}</DialogTitle>
          <DialogDescription>{copy.description}</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so every opening starts from the current selection. */}
        {open && <SkillPickerBody {...body} />}
      </DialogContent>
    </Dialog>
  );
}
