"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, apiRequest } from "@/components/learning/api-client";
import { requestCopy } from "@/lib/copy-learning";
import { projectsCopy } from "@/lib/copy-projects";
import type { ProjectStatus } from "@/lib/db/schema/enums";
import { webHref } from "@/lib/safe-url";
import { ProjectStatusControl } from "./project-status-control";
import { formatTechStack, parseTechStack } from "./tech-stack";

interface Props {
  project: {
    id: string;
    name: string;
    description: string;
    problemStatement: string;
    techStack: string[];
    repoUrl: string | null;
    status: ProjectStatus;
  };
}

const overview = projectsCopy.overview;
const copy = projectsCopy.details;

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1">
      <dt className="text-muted-foreground text-sm font-medium">{label}</dt>
      <dd className="text-sm text-pretty">{children}</dd>
    </div>
  );
}

/** Why the project exists, what it is built with, where its code lives, and its status. */
export function ProjectDetails({ project }: Props) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(project.name);
  const [why, setWhy] = useState(project.problemStatement);
  const [description, setDescription] = useState(project.description);
  const [tech, setTech] = useState(formatTechStack(project.techStack));
  const [repoUrl, setRepoUrl] = useState(project.repoUrl ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Only an http(s) address becomes a link, whatever was saved.
  const repoHref = webHref(project.repoUrl);

  function startEditing() {
    setName(project.name);
    setWhy(project.problemStatement);
    setDescription(project.description);
    setTech(formatTechStack(project.techStack));
    setRepoUrl(project.repoUrl ?? "");
    setError(null);
    setFieldErrors({});
    setEditing(true);
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});
    try {
      await apiRequest(`/api/v1/projects/${project.id}`, {
        method: "PATCH",
        body: {
          name,
          problemStatement: why,
          description,
          techStack: parseTechStack(tech),
          repoUrl: repoUrl.trim() || null,
        },
      });
      toast.success(copy.saved);
      setEditing(false);
      router.refresh();
    } catch (caught) {
      if (caught instanceof ApiError) {
        const fields = caught.fieldErrors();
        setFieldErrors(fields);
        setError(Object.keys(fields).length > 0 ? null : caught.message);
      } else {
        setError(requestCopy.unexpected);
      }
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      aria-labelledby="details-heading"
      className="bg-card space-y-4 rounded-2xl border p-4 sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <h2 id="details-heading" className="font-display text-xl font-semibold">
          {overview.whyHeading}
        </h2>
        {!editing && (
          <Button type="button" variant="ghost" size="sm" onClick={startEditing}>
            <Pencil aria-hidden />
            {overview.editDetails}
          </Button>
        )}
      </div>

      {editing ? (
        <form onSubmit={save} className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="details-name">{copy.nameLabel}</Label>
            <Input
              id="details-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={120}
              required
              aria-invalid={Boolean(fieldErrors.name)}
              aria-describedby={fieldErrors.name ? "details-name-error" : undefined}
            />
            {fieldErrors.name && (
              <p id="details-name-error" role="alert" className="text-destructive text-sm">
                {fieldErrors.name}
              </p>
            )}
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="details-why">{copy.whyLabel}</Label>
            <Textarea
              id="details-why"
              value={why}
              onChange={(event) => setWhy(event.target.value)}
              placeholder={projectsCopy.form.whyPlaceholder}
              maxLength={1000}
              rows={2}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="details-description">{copy.descriptionLabel}</Label>
            <Textarea
              id="details-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder={projectsCopy.form.descriptionPlaceholder}
              maxLength={1000}
              rows={2}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="details-tech">{copy.techLabel}</Label>
            <Input
              id="details-tech"
              value={tech}
              onChange={(event) => setTech(event.target.value)}
              placeholder={projectsCopy.form.techPlaceholder}
              aria-describedby="details-tech-hint"
            />
            <p id="details-tech-hint" className="text-muted-foreground text-xs">
              {copy.techHint}
            </p>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="details-repo">{copy.repoLabel}</Label>
            <Input
              id="details-repo"
              type="url"
              inputMode="url"
              value={repoUrl}
              onChange={(event) => setRepoUrl(event.target.value)}
              placeholder={projectsCopy.form.repoPlaceholder}
              maxLength={300}
              aria-invalid={Boolean(fieldErrors.repoUrl)}
              aria-describedby={fieldErrors.repoUrl ? "details-repo-error" : undefined}
            />
            {fieldErrors.repoUrl && (
              <p id="details-repo-error" role="alert" className="text-destructive text-sm">
                {fieldErrors.repoUrl}
              </p>
            )}
          </div>

          <div aria-live="polite">
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              {pending ? copy.saving : copy.save}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setEditing(false)}>
              {copy.cancel}
            </Button>
          </div>
        </form>
      ) : (
        <dl className="grid gap-4">
          <Fact label={overview.whyHeading}>
            {project.problemStatement ? (
              project.problemStatement
            ) : (
              <span className="text-muted-foreground">{overview.whyEmpty}</span>
            )}
          </Fact>
          {project.description && (
            <Fact label={overview.descriptionHeading}>{project.description}</Fact>
          )}
          <Fact label={overview.techHeading}>
            {project.techStack.length > 0 ? (
              <ul className="flex flex-wrap gap-1.5">
                {project.techStack.map((item) => (
                  <li
                    key={item}
                    className="text-muted-foreground rounded-full border px-2.5 py-0.5 text-xs"
                  >
                    {item}
                  </li>
                ))}
              </ul>
            ) : (
              <span className="text-muted-foreground">{overview.techEmpty}</span>
            )}
          </Fact>
          <Fact label={overview.repoHeading}>
            {repoHref ? (
              <a
                href={repoHref}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1 break-all underline underline-offset-4"
              >
                {project.repoUrl}
                <ExternalLink className="size-3.5 shrink-0" aria-hidden />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
            ) : project.repoUrl ? (
              <span className="break-all">{project.repoUrl}</span>
            ) : (
              <span className="text-muted-foreground">{overview.repoEmpty}</span>
            )}
          </Fact>
        </dl>
      )}

      <div className="border-t pt-4">
        <ProjectStatusControl projectId={project.id} status={project.status} />
      </div>
    </section>
  );
}
