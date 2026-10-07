import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { EvidenceForm } from "@/components/evidence/evidence-form";
import { orNotFound } from "@/components/learning/or-not-found";
import { PageHeader } from "@/components/page-header";
import { getEvidence } from "@/domain/evidence/evidence";
import { listPickableRepositories } from "@/domain/integrations/github/repositories";
import { listConcepts } from "@/domain/learning/concepts";
import { listSkills } from "@/domain/learning/skills";
import { getPageContext } from "@/lib/app-context";
import { evidenceCopy } from "@/lib/copy-evidence";

export const metadata: Metadata = { title: "Edit evidence" };

export default async function EditEvidencePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getPageContext();
  const [evidence, conceptPage, catalog, githubRepos] = await Promise.all([
    orNotFound(getEvidence(c, id)),
    listConcepts(c, { limit: 100 }),
    listSkills(c),
    listPickableRepositories(c),
  ]);
  // Keep concepts that are already linked selectable even if they fall outside the first page.
  const concepts = new Map(conceptPage.items.map((concept) => [concept.id, concept.name]));
  for (const concept of evidence.concepts) concepts.set(concept.id, concept.name);

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href={`/evidence/${evidence.id}`}
            className="hover:text-foreground inline-flex items-center gap-1 underline-offset-4 hover:underline"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            {evidence.title}
          </Link>
        }
        title={evidenceCopy.form.editTitle}
      />
      <EvidenceForm
        mode="edit"
        evidenceId={evidence.id}
        projects={[{ id: evidence.project.id, name: evidence.project.name }]}
        concepts={[...concepts].map(([cid, name]) => ({ id: cid, name }))}
        catalog={catalog}
        githubRepos={githubRepos}
        initial={{
          projectId: evidence.projectId,
          sessionId: evidence.sessionId,
          title: evidence.title,
          description: evidence.description,
          explanation: evidence.explanation,
          artifactType: evidence.artifactType,
          artifactUrl: evidence.artifactUrl ?? "",
          contributionType: evidence.contributionType,
          conceptIds: evidence.concepts.map((concept) => concept.id),
          skillIds: evidence.skills.map((skill) => skill.id),
        }}
      />
    </>
  );
}
