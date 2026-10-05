"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { learnCopy, requestCopy } from "@/lib/copy-learning";
import { ApiError, apiRequest } from "./api-client";
import { SkillPicker, type SkillOption } from "./skill-picker";

interface Props {
  conceptId: string;
  skills: SkillOption[];
  /** Every skill the student can choose from. */
  catalog: SkillOption[];
}

const copy = learnCopy.concept;

/** A concept's skills: removable chips, and a picker to add more. Saves the full set each time. */
export function ConceptSkills({ conceptId, skills, catalog }: Props) {
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function save(ids: string[]) {
    await apiRequest(`/api/v1/concepts/${conceptId}`, { method: "PATCH", body: { skillIds: ids } });
    toast.success(copy.skillsSaved);
    router.refresh();
  }

  async function remove(skill: SkillOption) {
    setRemovingId(skill.id);
    setError(null);
    try {
      await save(skills.filter((current) => current.id !== skill.id).map((current) => current.id));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : requestCopy.unexpected);
    } finally {
      setRemovingId(null);
    }
  }

  return (
    <div className="space-y-3">
      {skills.length === 0 ? (
        <p className="text-muted-foreground text-sm text-pretty">{copy.skillsEmpty}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {skills.map((skill) => (
            <li
              key={skill.id}
              className="bg-secondary text-secondary-foreground inline-flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-3 text-sm"
            >
              {skill.name}
              <button
                type="button"
                onClick={() => void remove(skill)}
                disabled={removingId === skill.id}
                aria-label={copy.removeSkill(skill.name)}
                className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 flex size-6 items-center justify-center rounded-full outline-none focus-visible:ring-3 disabled:opacity-50"
              >
                {removingId === skill.id ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <X className="size-3.5" aria-hidden />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      <Button type="button" variant="outline" size="sm" onClick={() => setPickerOpen(true)}>
        <Plus aria-hidden />
        {copy.addSkills}
      </Button>

      <div aria-live="polite">
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </div>

      <SkillPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        catalog={catalog}
        selectedIds={skills.map((skill) => skill.id)}
        onConfirm={async (ids) => {
          await save(ids);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}
