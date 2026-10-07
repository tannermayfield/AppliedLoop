import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { z } from "zod";
import { EvidenceForm, type EvidenceFormValues } from "@/components/evidence/evidence-form";
import { PageHeader } from "@/components/page-header";
import { getEvidencePrefill } from "@/domain/evidence/prefill";
import { listPickableRepositories } from "@/domain/integrations/github/repositories";
import { getConcept, listConcepts } from "@/domain/learning/concepts";
import { listSkills } from "@/domain/learning/skills";
import { listProjects } from "@/domain/projects/projects";
import { getPageContext } from "@/lib/app-context";
import { DomainError } from "@/lib/errors";
import { evidenceCopy } from "@/lib/copy-evidence";

export const metadata: Metadata = { title: "Add evidence" };

const copy = evidenceCopy;
const guid = z.guid();
const idParam = (value: string | string[] | undefined) => {
  const found = Array.isArray(value) ? value[0] : value;
  return found && guid.safeParse(found).success ? found : undefined;
};

export default async function NewEvidencePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const sessionId = idParam(raw.sessionId);
  const projectId = idParam(raw.projectId);
  const conceptId = idParam(raw.conceptId);
  const c = await getPageContext();

  const [projects, conceptPage, catalog, githubRepos] = await Promise.all([
    listProjects(c),
    listConcepts(c, { limit: 100 }),
    listSkills(c),
    listPickableRepositories(c),
  ]);

  const initial: EvidenceFormValues = {
    projectId: projectId ?? "",
    sessionId: null,
    title: "",
    description: "",
    explanation: "",
    artifactType: "PR",
    artifactUrl: "",
    contributionType: "MIXED_UNSURE",
    conceptIds: [],
    skillIds: [],
  };
  let notice: string | undefined;

  if (sessionId) {
    try {
      const prefill = await getEvidencePrefill(c, { sessionId });
      Object.assign(initial, {
        projectId: prefill.projectId,
        sessionId: prefill.sessionId,
        title: prefill.title,
        description: prefill.description,
        explanation: prefill.explanation,
        contributionType: prefill.contributionType,
        conceptIds: prefill.conceptIds,
        skillIds: prefill.skillIds,
      });
    } catch (error) {
      // An unknown or unfinished session is not a dead end: the student can still fill the form.
      if (!(error instanceof DomainError)) throw error;
      notice = error.code === "CONFLICT" ? error.message : copy.form.prefillFailed;
    }
  }

  if (conceptId && !initial.conceptIds.includes(conceptId)) {
    const known = conceptPage.items.find((concept) => concept.id === conceptId);
    if (known) {
      const concept = await getConcept(c, conceptId);
      initial.conceptIds = [...initial.conceptIds, concept.id];
      initial.skillIds = [...new Set([...initial.skillIds, ...concept.skills.map((s) => s.id)])];
    }
  }

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href="/evidence"
            className="hover:text-foreground inline-flex items-center gap-1 underline-offset-4 hover:underline"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            {copy.detail.back}
          </Link>
        }
        title={copy.form.newTitle}
        description={copy.form.newDescription}
      />
      <EvidenceForm
        mode="create"
        projects={projects.map((project) => ({ id: project.id, name: project.name }))}
        concepts={conceptPage.items.map((concept) => ({ id: concept.id, name: concept.name }))}
        catalog={catalog}
        initial={initial}
        notice={notice}
        githubRepos={githubRepos}
      />
    </>
  );
}
