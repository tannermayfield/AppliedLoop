import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Pencil } from "lucide-react";
import { ArtifactRef } from "@/components/evidence/evidence-card";
import { DeleteEvidenceButton } from "@/components/evidence/delete-evidence-button";
import { formatDateTime } from "@/components/learning/format";
import { orNotFound } from "@/components/learning/or-not-found";
import { PageHeader } from "@/components/page-header";
import { StageBadge } from "@/components/stage-badge";
import { Button } from "@/components/ui/button";
import { getEvidence } from "@/domain/evidence/evidence";
import { getMe } from "@/domain/identity/me";
import { getPageContext } from "@/lib/app-context";
import { CONTRIBUTION_LABELS } from "@/lib/copy";
import { evidenceCopy } from "@/lib/copy-evidence";
import { githubCopy } from "@/lib/copy-integrations";

export const metadata: Metadata = { title: "Evidence" };

const copy = evidenceCopy.detail;

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <dt className="text-muted-foreground text-xs font-medium">{label}</dt>
      <dd className="text-sm text-pretty">{children}</dd>
    </div>
  );
}

export default async function EvidenceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getPageContext();
  const [evidence, me] = await Promise.all([orNotFound(getEvidence(c, id)), getMe(c)]);
  const timeZone = me.profile.timezone;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link
            href="/evidence"
            className="hover:text-foreground inline-flex items-center gap-1 underline-offset-4 hover:underline"
          >
            <ArrowLeft className="size-3.5" aria-hidden />
            {copy.back}
          </Link>
        }
        title={evidence.title}
        description={`${copy.added} ${formatDateTime(evidence.createdAt, { timeZone })}`}
        actions={
          <>
            <Button asChild variant="outline">
              <Link href={`/evidence/${evidence.id}/edit`}>
                <Pencil aria-hidden /> {copy.edit}
              </Link>
            </Button>
            <DeleteEvidenceButton evidenceId={evidence.id} />
          </>
        }
      />

      <dl className="bg-card grid max-w-2xl gap-5 rounded-2xl border p-4 sm:p-6">
        <Field label={copy.explanation}>
          {evidence.explanation.trim() ? (
            <span className="whitespace-pre-wrap">{evidence.explanation}</span>
          ) : (
            <span className="text-muted-foreground">{evidenceCopy.list.noExplanation}</span>
          )}
        </Field>
        {evidence.description && (
          <Field label={copy.description}>
            <span className="whitespace-pre-wrap">{evidence.description}</span>
          </Field>
        )}
        <Field label={copy.artifact}>
          <ArtifactRef type={evidence.artifactType} value={evidence.artifactUrl} />
          {evidence.githubArtifact && (
            <span className="text-muted-foreground mt-1 block text-xs">
              {githubCopy.evidence.fromGitHub(evidence.githubArtifact.repositoryFullName)}
              {evidence.githubArtifact.stale && (
                <span role="note" className="mt-1 block">
                  {githubCopy.evidence.stale}
                </span>
              )}
            </span>
          )}
        </Field>
        <Field label={copy.contribution}>{CONTRIBUTION_LABELS[evidence.contributionType]}</Field>
        <Field label={copy.project}>
          <Link href={`/projects/${evidence.project.id}`} className="underline underline-offset-4">
            {evidence.project.name}
          </Link>
        </Field>
        {evidence.session && (
          <Field label={copy.session}>
            <Link
              href={`/sessions/${evidence.session.id}`}
              className="underline underline-offset-4"
            >
              {evidence.session.type === "APPLY" ? copy.sessionApply : copy.sessionBuild}
            </Link>
          </Field>
        )}
        <Field label={copy.concepts}>
          {evidence.concepts.length === 0 ? (
            <span className="text-muted-foreground">{copy.noConcepts}</span>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {evidence.concepts.map((concept) => (
                <li key={concept.id} className="flex items-center gap-2">
                  <Link
                    href={`/learn/concepts/${concept.id}`}
                    className="underline underline-offset-4"
                  >
                    {concept.name}
                  </Link>
                  <StageBadge stage={concept.stage} />
                </li>
              ))}
            </ul>
          )}
        </Field>
        <Field label={copy.skills}>
          {evidence.skills.length === 0 ? (
            <span className="text-muted-foreground">{copy.noSkills}</span>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {evidence.skills.map((skill) => (
                <li key={skill.id} className="bg-secondary rounded-full px-2.5 py-0.5">
                  {skill.name}
                </li>
              ))}
            </ul>
          )}
        </Field>
      </dl>
    </>
  );
}
