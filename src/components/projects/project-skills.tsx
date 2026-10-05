"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ApiError, apiRequest } from "@/components/learning/api-client";
import { SkillPicker, type SkillOption } from "@/components/learning/skill-picker";
import { requestCopy } from "@/lib/copy-learning";
import { projectsCopy } from "@/lib/copy-projects";

interface Props {
  projectId: string;
  skills: SkillOption[];
  /** Every skill the student can choose from. */
  catalog: SkillOption[];
}

const copy = projectsCopy.overview;

/** The skills this project develops: removable chips and a picker to add more. */
export function ProjectSkills({ projectId, skills, catalog }: Props) {
  const router = useRouter();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(skill: SkillOption) {
    setRemovingId(skill.id);
    setError(null);
    try {
      await apiRequest(`/api/v1/projects/${projectId}/skills/${skill.id}`, { method: "DELETE" });
      toast.success(copy.skillsSaved);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : requestCopy.unexpected);
    } finally {
      setRemovingId(null);
    }
  }

  /** The picker hands back the full set; link what is new and unlink what was deselected. */
  async function apply(ids: string[]) {
    const current = new Set(skills.map((skill) => skill.id));
    const wanted = new Set(ids);
    const added = ids.filter((id) => !current.has(id));
    const removed = [...current].filter((id) => !wanted.has(id));

    if (added.length > 0) {
      await apiRequest(`/api/v1/projects/${projectId}/skills`, {
        method: "POST",
        body: { skillIds: added },
      });
    }
    for (const id of removed) {
      await apiRequest(`/api/v1/projects/${projectId}/skills/${id}`, { method: "DELETE" });
    }
    toast.success(copy.skillsSaved);
    router.refresh();
  }

  return (
    <section
      aria-labelledby="skills-heading"
      className="bg-card space-y-3 rounded-2xl border p-4 sm:p-5"
    >
      <h2 id="skills-heading" className="font-display text-xl font-semibold">
        {copy.skillsHeading}
      </h2>

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
          await apply(ids);
          setPickerOpen(false);
        }}
      />
    </section>
  );
}
