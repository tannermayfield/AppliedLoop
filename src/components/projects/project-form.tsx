"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, apiRequest } from "@/components/learning/api-client";
import { requestCopy } from "@/lib/copy-learning";
import { STARTER_MILESTONE, projectsCopy } from "@/lib/copy-projects";
import { parseTechStack } from "./tech-stack";

type StartMode = "HAVE_PROJECT" | "STARTING_ONE";

const copy = projectsCopy.form;

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-destructive text-sm">
      {message}
    </p>
  );
}

/** Create a project: only the name is required. Includes the "I'm starting one" path (D-6). */
export function ProjectForm() {
  const router = useRouter();
  const [mode, setMode] = useState<StartMode>("HAVE_PROJECT");
  const [name, setName] = useState("");
  const [why, setWhy] = useState("");
  const [description, setDescription] = useState("");
  const [milestone, setMilestone] = useState("");
  const [tech, setTech] = useState("");
  const [repoUrl, setRepoUrl] = useState("");
  const [aiEnabled, setAiEnabled] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      const created = await apiRequest<{ id: string }>("/api/v1/projects", {
        method: "POST",
        body: {
          name,
          problemStatement: why,
          description,
          currentMilestone: milestone,
          techStack: parseTechStack(tech),
          repoUrl: repoUrl.trim() || null,
          aiEnabled,
          startMode: mode,
        },
      });
      router.push(`/projects/${created.id}`);
    } catch (caught) {
      if (caught instanceof ApiError) {
        const fields = caught.fieldErrors();
        setFieldErrors(fields);
        setError(Object.keys(fields).length > 0 ? null : caught.message);
      } else {
        setError(requestCopy.unexpected);
      }
      setPending(false);
    }
  }

  const paths: { value: StartMode; label: string; hint?: string }[] = [
    { value: "HAVE_PROJECT", label: copy.have },
    { value: "STARTING_ONE", label: copy.starting, hint: copy.startingHint },
  ];

  return (
    <form onSubmit={submit} className="bg-card grid max-w-2xl gap-5 rounded-2xl border p-4 sm:p-6">
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{copy.pathLabel}</legend>
        <RadioGroup
          value={mode}
          onValueChange={(value) => setMode(value as StartMode)}
          className="grid gap-2 sm:grid-cols-2"
        >
          {paths.map((path) => (
            <Label
              key={path.value}
              htmlFor={`path-${path.value}`}
              className="border-input has-[[data-state=checked]]:border-ring has-[[data-state=checked]]:bg-secondary/60 flex cursor-pointer items-start gap-3 rounded-xl border p-3 font-normal"
            >
              <RadioGroupItem id={`path-${path.value}`} value={path.value} className="mt-0.5" />
              <span className="grid gap-0.5 leading-snug">
                <span className="font-medium">{path.label}</span>
                {path.hint && <span className="text-muted-foreground text-xs">{path.hint}</span>}
              </span>
            </Label>
          ))}
        </RadioGroup>
      </fieldset>

      <div className="grid gap-1.5">
        <Label htmlFor="project-name">{copy.nameLabel}</Label>
        <Input
          id="project-name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder={copy.namePlaceholder}
          maxLength={120}
          required
          aria-invalid={Boolean(fieldErrors.name)}
          aria-describedby={fieldErrors.name ? "project-name-error" : undefined}
          className="h-10 sm:h-9"
        />
        <FieldError id="project-name-error" message={fieldErrors.name} />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="project-why">{copy.whyLabel}</Label>
        <Textarea
          id="project-why"
          value={why}
          onChange={(event) => setWhy(event.target.value)}
          placeholder={copy.whyPlaceholder}
          maxLength={1000}
          rows={2}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="project-description">{copy.descriptionLabel}</Label>
        <Textarea
          id="project-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder={copy.descriptionPlaceholder}
          maxLength={1000}
          rows={2}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="project-milestone">{copy.milestoneLabel}</Label>
        <Input
          id="project-milestone"
          value={milestone}
          onChange={(event) => setMilestone(event.target.value)}
          placeholder={mode === "STARTING_ONE" ? STARTER_MILESTONE : copy.milestonePlaceholder}
          maxLength={200}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="project-tech">{copy.techLabel}</Label>
        <Input
          id="project-tech"
          value={tech}
          onChange={(event) => setTech(event.target.value)}
          placeholder={copy.techPlaceholder}
          aria-describedby="project-tech-hint"
        />
        <p id="project-tech-hint" className="text-muted-foreground text-xs">
          {copy.techHint}
        </p>
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="project-repo">{copy.repoLabel}</Label>
        <Input
          id="project-repo"
          type="url"
          inputMode="url"
          value={repoUrl}
          onChange={(event) => setRepoUrl(event.target.value)}
          placeholder={copy.repoPlaceholder}
          maxLength={300}
          aria-invalid={Boolean(fieldErrors.repoUrl)}
          aria-describedby={fieldErrors.repoUrl ? "project-repo-error" : undefined}
        />
        <FieldError id="project-repo-error" message={fieldErrors.repoUrl} />
      </div>

      <div className="flex items-start gap-3">
        <Switch
          id="project-ai"
          checked={aiEnabled}
          onCheckedChange={setAiEnabled}
          aria-describedby="project-ai-hint"
          className="mt-0.5"
        />
        <div className="grid gap-0.5">
          <Label htmlFor="project-ai">{projectsCopy.ai.label}</Label>
          <p id="project-ai-hint" className="text-muted-foreground text-xs">
            {aiEnabled ? projectsCopy.ai.onHint : projectsCopy.ai.offHint}
          </p>
        </div>
      </div>

      <div aria-live="polite">
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending} className="h-10 px-4 sm:h-9">
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {pending ? copy.submitting : copy.submit}
        </Button>
        <Button asChild variant="ghost" className="h-10 px-4 sm:h-9">
          <Link href="/projects">{copy.cancel}</Link>
        </Button>
      </div>
    </form>
  );
}
