"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { ApiError, apiRequest } from "@/components/learning/api-client";
import { NativeSelect } from "@/components/learning/native-select";
import { SkillPicker } from "@/components/learning/skill-picker";
import { ArtifactPicker } from "@/components/integrations/artifact-picker";
import type { SkillDto } from "@/domain/learning/skills";
import { CONTRIBUTION_LABELS } from "@/lib/copy";
import { githubCopy } from "@/lib/copy-integrations";
import { requestCopy } from "@/lib/copy-learning";
import { ARTIFACT_HINTS, ARTIFACT_LABELS, evidenceCopy } from "@/lib/copy-evidence";
import { ARTIFACT_TYPES, CONTRIBUTION_TYPES } from "@/lib/db/schema/enums";
import type { ArtifactType, ContributionType } from "@/lib/db/schema/enums";
import { AdvanceCards, type AdvanceSuggestion } from "./advance-cards";

const copy = evidenceCopy.form;

export interface EvidenceFormValues {
  projectId: string;
  sessionId: string | null;
  title: string;
  description: string;
  explanation: string;
  artifactType: ArtifactType;
  artifactUrl: string;
  /** Set while the link is a GitHub item picked in this form (P1). */
  githubArtifactId?: string | null;
  contributionType: ContributionType;
  conceptIds: string[];
  skillIds: string[];
}

interface Props {
  mode: "create" | "edit";
  evidenceId?: string;
  projects: { id: string; name: string }[];
  concepts: { id: string; name: string }[];
  catalog: SkillDto[];
  initial: EvidenceFormValues;
  /** A message to show above the form (e.g. the prefill could not be loaded). */
  notice?: string;
  /** Project id → "owner/name" for projects whose linked GitHub repository can be read now. */
  githubRepos?: Record<string, string>;
}

function FieldError({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-destructive text-sm">
      {message}
    </p>
  );
}

export function EvidenceForm({
  mode,
  evidenceId,
  projects,
  concepts,
  catalog,
  initial,
  notice,
  githubRepos = {},
}: Props) {
  const router = useRouter();
  const [values, setValues] = useState(initial);
  const [pickedTitle, setPickedTitle] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [saved, setSaved] = useState<{ id: string; advances: AdvanceSuggestion[] } | null>(null);

  const set = <K extends keyof EvidenceFormValues>(key: K, value: EvidenceFormValues[K]) =>
    setValues((current) => ({ ...current, [key]: value }));

  /** Editing the link by hand makes it a plain pasted link again. */
  const setArtifact = (patch: Partial<Pick<EvidenceFormValues, "artifactType" | "artifactUrl">>) => {
    setValues((current) => ({ ...current, ...patch, githubArtifactId: null }));
    setPickedTitle(null);
  };

  const toggleConcept = (id: string, checked: boolean) =>
    set(
      "conceptIds",
      checked ? [...values.conceptIds, id] : values.conceptIds.filter((x) => x !== id),
    );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);
    setFieldErrors({});
    const isNote = values.artifactType === "NOTE";
    const common = {
      title: values.title,
      description: values.description,
      explanation: values.explanation,
      artifactType: values.artifactType,
      artifactUrl: isNote ? null : values.artifactUrl.trim() || null,
      ...(values.githubArtifactId ? { githubArtifactId: values.githubArtifactId } : {}),
      contributionType: values.contributionType,
      conceptIds: values.conceptIds,
      skillIds: values.skillIds,
    };
    try {
      if (mode === "create") {
        const result = await apiRequest<{
          evidence: { id: string };
          suggestedAdvances: AdvanceSuggestion[];
        }>("/api/v1/evidence", {
          method: "POST",
          body: { ...common, projectId: values.projectId, sessionId: values.sessionId },
        });
        if (result.suggestedAdvances.length > 0) {
          setSaved({ id: result.evidence.id, advances: result.suggestedAdvances });
          setPending(false);
          return;
        }
        router.push(`/evidence/${result.evidence.id}`);
      } else {
        await apiRequest(`/api/v1/evidence/${evidenceId}`, { method: "PATCH", body: common });
        router.push(`/evidence/${evidenceId}`);
        router.refresh();
      }
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

  if (saved) return <AdvanceCards suggestions={saved.advances} evidenceId={saved.id} />;

  if (mode === "create" && projects.length === 0) {
    return (
      <div className="bg-card max-w-2xl space-y-3 rounded-2xl border p-4 sm:p-6">
        <p>{copy.noProjects}</p>
        <Button asChild>
          <Link href="/projects/new">{copy.addProject}</Link>
        </Button>
      </div>
    );
  }

  const chosenSkills = catalog.filter((skill) => values.skillIds.includes(skill.id));
  const needsLink = values.artifactType !== "NOTE";
  const githubRepo = githubRepos[values.projectId];

  return (
    <form onSubmit={submit} className="bg-card grid max-w-2xl gap-5 rounded-2xl border p-4 sm:p-6">
      {notice && (
        <p role="status" className="text-muted-foreground text-sm">
          {notice}
        </p>
      )}

      <div className="grid gap-1.5">
        <Label htmlFor="evidence-project">{copy.project}</Label>
        <NativeSelect
          id="evidence-project"
          value={values.projectId}
          onChange={(event) => set("projectId", event.target.value)}
          disabled={mode === "edit" || values.sessionId !== null}
          required
          aria-invalid={Boolean(fieldErrors.projectId)}
          className="h-10 sm:h-9"
        >
          <option value="" disabled>
            {copy.projectPlaceholder}
          </option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </NativeSelect>
        <FieldError id="evidence-project-error" message={fieldErrors.projectId} />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="evidence-title">{copy.title}</Label>
        <Input
          id="evidence-title"
          value={values.title}
          onChange={(event) => set("title", event.target.value)}
          placeholder={copy.titlePlaceholder}
          maxLength={140}
          required
          aria-invalid={Boolean(fieldErrors.title)}
          aria-describedby={fieldErrors.title ? "evidence-title-error" : undefined}
          className="h-10 sm:h-9"
        />
        <FieldError id="evidence-title-error" message={fieldErrors.title} />
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{copy.concepts}</legend>
        {concepts.length === 0 ? (
          <p className="text-muted-foreground text-sm">{copy.conceptsEmpty}</p>
        ) : (
          <div className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border p-2">
            {concepts.map((concept) => (
              <Label
                key={concept.id}
                htmlFor={`concept-${concept.id}`}
                className="flex min-h-9 cursor-pointer items-center gap-2 font-normal"
              >
                <Checkbox
                  id={`concept-${concept.id}`}
                  checked={values.conceptIds.includes(concept.id)}
                  onCheckedChange={(checked) => toggleConcept(concept.id, checked === true)}
                />
                {concept.name}
              </Label>
            ))}
          </div>
        )}
      </fieldset>

      <div className="grid gap-1.5">
        <span className="text-sm font-medium" id="evidence-skills-label">
          {copy.skills}
        </span>
        <div className="flex flex-wrap items-center gap-2">
          {chosenSkills.length === 0 && (
            <span className="text-muted-foreground text-sm">{copy.skillsEmpty}</span>
          )}
          {chosenSkills.map((skill) => (
            <span key={skill.id} className="bg-secondary rounded-full px-2.5 py-0.5 text-sm">
              {skill.name}
            </span>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            aria-describedby="evidence-skills-label"
            onClick={() => setPickerOpen(true)}
          >
            {copy.chooseSkills}
          </Button>
        </div>
        <SkillPicker
          open={pickerOpen}
          onOpenChange={setPickerOpen}
          catalog={catalog}
          selectedIds={values.skillIds}
          onConfirm={async (ids) => {
            set("skillIds", ids);
            setPickerOpen(false);
          }}
        />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="evidence-explanation">{copy.explanation}</Label>
        <Textarea
          id="evidence-explanation"
          value={values.explanation}
          onChange={(event) => set("explanation", event.target.value)}
          maxLength={4000}
          rows={5}
          aria-describedby="evidence-explanation-help"
        />
        <p id="evidence-explanation-help" className="text-muted-foreground text-xs">
          {copy.explanationHelp}
        </p>
        <FieldError id="evidence-explanation-error" message={fieldErrors.explanation} />
      </div>

      <div className="grid gap-1.5">
        <Label htmlFor="evidence-description">{copy.description}</Label>
        <Textarea
          id="evidence-description"
          value={values.description}
          onChange={(event) => set("description", event.target.value)}
          maxLength={2000}
          rows={2}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-[12rem_1fr]">
        <div className="grid content-start gap-1.5">
          <Label htmlFor="evidence-artifact-type">{copy.artifactType}</Label>
          <NativeSelect
            id="evidence-artifact-type"
            value={values.artifactType}
            onChange={(event) => setArtifact({ artifactType: event.target.value as ArtifactType })}
            className="h-10 sm:h-9"
          >
            {ARTIFACT_TYPES.map((type) => (
              <option key={type} value={type}>
                {ARTIFACT_LABELS[type]}
              </option>
            ))}
          </NativeSelect>
        </div>
        {needsLink && (
          <div className="grid content-start gap-1.5">
            <Label htmlFor="evidence-artifact-url">{copy.artifactUrl}</Label>
            <Input
              id="evidence-artifact-url"
              value={values.artifactUrl}
              onChange={(event) => setArtifact({ artifactUrl: event.target.value })}
              placeholder={ARTIFACT_HINTS[values.artifactType]}
              maxLength={2000}
              aria-invalid={Boolean(fieldErrors.artifactUrl)}
              aria-describedby={fieldErrors.artifactUrl ? "evidence-artifact-url-error" : undefined}
              className="h-10 sm:h-9"
            />
            <FieldError id="evidence-artifact-url-error" message={fieldErrors.artifactUrl} />
          </div>
        )}
        {githubRepo && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 sm:col-span-2">
            <ArtifactPicker
              projectId={values.projectId}
              repositoryName={githubRepo}
              onPicked={(artifact) => {
                setValues((current) => ({
                  ...current,
                  artifactType: artifact.type === "RELEASE" ? "URL" : artifact.type,
                  artifactUrl: artifact.url,
                  githubArtifactId: artifact.id,
                }));
                setPickedTitle(artifact.title);
              }}
            />
            <p aria-live="polite" className="text-muted-foreground min-w-0 text-xs break-words">
              {pickedTitle
                ? githubCopy.artifactPicker.picked(pickedTitle)
                : githubCopy.artifactPicker.from(githubRepo)}
            </p>
            <FieldError id="evidence-github-artifact-error" message={fieldErrors.githubArtifactId} />
          </div>
        )}
      </div>

      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">{copy.contribution}</legend>
        <RadioGroup
          value={values.contributionType}
          onValueChange={(value) => set("contributionType", value as ContributionType)}
          aria-describedby="evidence-contribution-help"
          className="grid gap-2 sm:grid-cols-2"
        >
          {CONTRIBUTION_TYPES.map((type) => (
            <Label
              key={type}
              htmlFor={`contribution-${type}`}
              className="border-input has-[[data-state=checked]]:border-ring has-[[data-state=checked]]:bg-secondary/60 flex min-h-11 cursor-pointer items-center gap-3 rounded-xl border p-3 font-normal"
            >
              <RadioGroupItem id={`contribution-${type}`} value={type} />
              {CONTRIBUTION_LABELS[type]}
            </Label>
          ))}
        </RadioGroup>
        <p id="evidence-contribution-help" className="text-muted-foreground text-xs">
          {copy.contributionHelp}
        </p>
      </fieldset>

      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          {pending ? copy.saving : copy.save}
        </Button>
        <Button asChild variant="ghost">
          <Link href={mode === "edit" && evidenceId ? `/evidence/${evidenceId}` : "/evidence"}>
            {copy.cancel}
          </Link>
        </Button>
      </div>
    </form>
  );
}
