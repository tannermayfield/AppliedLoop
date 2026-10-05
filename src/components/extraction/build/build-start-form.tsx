"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { Hammer } from "lucide-react";
import { NativeSelect } from "@/components/learning/native-select";
import { api } from "@/components/sessions/api";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { BuildProjectChoice } from "@/domain/sessions/build/build";
import { BUILD_COPY } from "@/lib/copy-build";

const t = BUILD_COPY.start;

/** Project + goal (prefilled from the milestone) → POST /api/v1/sessions (type BUILD). */
export function BuildStartForm({
  projects,
  projectId: initialProjectId,
}: {
  projects: BuildProjectChoice[];
  projectId: string;
}) {
  const router = useRouter();
  const ids = { project: useId(), goal: useId(), status: useId() };
  const milestoneOf = (id: string) => projects.find((p) => p.id === id)?.currentMilestone ?? "";
  const [projectId, setProjectId] = useState(initialProjectId);
  const [goal, setGoal] = useState(milestoneOf(initialProjectId));
  const [goalEdited, setGoalEdited] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function chooseProject(id: string) {
    setProjectId(id);
    if (!goalEdited) setGoal(milestoneOf(id));
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!projectId) {
      setError(t.pickProject);
      return;
    }
    setPending(true);
    setError(null);
    const result = await api<{ id: string }>("/api/v1/sessions", {
      body: { type: "BUILD", projectId, goal: goal.trim() || undefined },
    });
    if (result.ok) {
      router.push(`/sessions/${result.data.id}`);
      return;
    }
    setPending(false);
    setError(result.message);
  }

  return (
    <form onSubmit={submit} className="bg-card max-w-2xl space-y-5 rounded-2xl border p-4 sm:p-6">
      <div className="space-y-1.5">
        <Label htmlFor={ids.project}>{t.project}</Label>
        <NativeSelect
          id={ids.project}
          value={projectId}
          onChange={(event) => chooseProject(event.target.value)}
          className="h-10"
          required
        >
          <option value="">{t.projectPlaceholder}</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="space-y-1.5">
        <Label htmlFor={ids.goal}>{t.goal}</Label>
        <Textarea
          id={ids.goal}
          value={goal}
          maxLength={500}
          onChange={(event) => {
            setGoal(event.target.value);
            setGoalEdited(true);
          }}
          aria-describedby={`${ids.goal}-hint`}
        />
        <p id={`${ids.goal}-hint`} className="text-muted-foreground text-xs">
          {t.goalHint}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={pending}>
          <Hammer aria-hidden />
          {pending ? t.submitting : t.submit}
        </Button>
        <p id={ids.status} role="status" aria-live="polite" className="text-destructive text-sm">
          {error}
        </p>
      </div>
    </form>
  );
}
