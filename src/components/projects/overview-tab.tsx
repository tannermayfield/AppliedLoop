import Link from "next/link";
import { ModeBadge } from "@/components/mode-badge";
import { StageBadge } from "@/components/stage-badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime } from "@/components/learning/format";
import type { SkillOption } from "@/components/learning/skill-picker";
import { RepositoryCard } from "@/components/integrations/repository-card";
import type { GitHubConnectionDto } from "@/domain/integrations/github/integration";
import type { ProjectRepositoryDto } from "@/domain/integrations/github/repositories";
import type { ContextSnapshotDto } from "@/domain/projects/context";
import type { ProjectSummaryDto } from "@/domain/projects/projects";
import type { ApplyRecommendation } from "@/domain/today/today";
import { projectsCopy } from "@/lib/copy-projects";
import type { GitHubConnectNotice } from "@/lib/integrations/github/types";
import { AiToggle } from "./ai-toggle";
import { ContextEditor } from "./context-editor";
import { MilestoneEditor } from "./milestone-editor";
import { ProjectDetails } from "./project-details";
import { ProjectSkills } from "./project-skills";

const t = projectsCopy.overview;

interface Props {
  summary: ProjectSummaryDto;
  /** Saved context versions, newest first. */
  versions: ContextSnapshotDto[];
  catalog: SkillOption[];
  timeZone: string;
  /** P1 GitHub: connection status, the linked repository, and the `?github=` notice. */
  github: GitHubConnectionDto;
  repository: ProjectRepositoryDto | null;
  githubNotice: GitHubConnectNotice | null;
  /** Today's Apply choice for this project (the wireframe's "Recommended application"), if any. */
  recommended: ApplyRecommendation | null;
  /** Up to three open Needs Review concepts (pinned first); `summary.needsReviewCount` is the total. */
  needsReviewTop: { conceptId: string; name: string }[];
}

export function OverviewTab({
  summary,
  versions,
  catalog,
  timeZone,
  github,
  repository,
  githubNotice,
  recommended,
  needsReviewTop,
}: Props) {
  const { project } = summary;
  return (
    <div className="max-w-2xl space-y-6">
      {summary.activeSession && (
        <section
          aria-labelledby="resume-heading"
          className="bg-card flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 sm:p-5"
        >
          <div className="space-y-1.5">
            <h2 id="resume-heading" className="font-medium">
              {t.resumeHeading}
            </h2>
            <ModeBadge mode={summary.activeSession.type} showLabel={false} />
            {summary.activeSession.goal && (
              <p className="text-muted-foreground text-sm text-pretty">
                {summary.activeSession.goal}
              </p>
            )}
          </div>
          <Button asChild>
            <Link href={`/sessions/${summary.activeSession.id}`}>{t.resume}</Link>
          </Button>
        </section>
      )}

      <MilestoneEditor projectId={project.id} milestone={project.currentMilestone} />
      <ProjectDetails project={project} repoLinked={repository !== null} />
      <RepositoryCard
        projectId={project.id}
        github={github}
        repository={repository}
        notice={githubNotice}
      />
      <ProjectSkills projectId={project.id} skills={summary.skills} catalog={catalog} />

      {recommended && (
        <section
          aria-labelledby="recommended-heading"
          className="border-apply/30 bg-apply-soft flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4 sm:p-5"
        >
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="recommended-heading" className="text-sm font-medium">
                {t.recommendedHeading}
              </h2>
              <ModeBadge mode="APPLY" showLabel={false} />
            </div>
            <p className="font-display text-xl font-semibold text-balance">
              {recommended.conceptName}
            </p>
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <StageBadge stage={recommended.stage} />
              {t.recommendedBody(recommended.projectName)}
            </p>
          </div>
          <Button asChild>
            <Link
              href={recommended.href}
              aria-label={t.recommendedLabel(recommended.conceptName, recommended.projectName)}
            >
              {projectsCopy.actions.startApply}
            </Link>
          </Button>
        </section>
      )}

      {(summary.recentEvidence.length > 0 || summary.needsReviewCount > 0) && (
        <section className="bg-card space-y-3 rounded-2xl border p-4 sm:p-5">
          {summary.needsReviewCount > 0 && (
            <p className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
              <span className="font-medium">{t.needsReviewHeading}:</span>
              {needsReviewTop.map((item, index) => (
                <span key={item.conceptId} className="inline-flex items-baseline gap-2">
                  {index > 0 && (
                    <span aria-hidden className="text-muted-foreground">
                      ·
                    </span>
                  )}
                  <Link
                    href={`/learn/concepts/${item.conceptId}`}
                    aria-label={t.needsReviewConcept(item.name)}
                    className="underline underline-offset-4"
                  >
                    {item.name}
                  </Link>
                </span>
              ))}
              {summary.needsReviewCount > needsReviewTop.length && (
                <span className="text-muted-foreground">
                  {t.needsReviewMore(summary.needsReviewCount - needsReviewTop.length)}
                </span>
              )}
              <Link
                href={`/projects/${project.id}?tab=learning`}
                className="underline underline-offset-4"
              >
                {t.needsReviewLink}
              </Link>
            </p>
          )}
          {summary.recentEvidence.length > 0 && (
            <div>
              <h2 className="mb-1 text-sm font-medium">{t.recentEvidenceHeading}</h2>
              <ul className="text-muted-foreground space-y-0.5 text-sm">
                {summary.recentEvidence.map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/evidence/${item.id}`}
                      className="text-foreground underline-offset-4 hover:underline"
                    >
                      {item.title}
                    </Link>{" "}
                    · {formatDate(item.createdAt, { timeZone })}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      <AiToggle projectId={project.id} aiEnabled={project.aiEnabled} />

      <ContextEditor
        key={versions[0]?.id ?? "none"}
        projectId={project.id}
        versions={versions.map((version) => ({
          id: version.id,
          version: version.version,
          createdLabel: formatDateTime(version.createdAt, { timeZone }),
          summary: version.summary,
          architecture: version.architecture,
          dataModel: version.dataModel,
          constraints: version.constraints,
          decisions: version.decisions,
        }))}
      />
    </div>
  );
}
