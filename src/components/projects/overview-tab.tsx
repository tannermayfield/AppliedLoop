import Link from "next/link";
import { ModeBadge } from "@/components/mode-badge";
import { Button } from "@/components/ui/button";
import { formatDate, formatDateTime } from "@/components/learning/format";
import type { SkillOption } from "@/components/learning/skill-picker";
import type { ContextSnapshotDto } from "@/domain/projects/context";
import type { ProjectSummaryDto } from "@/domain/projects/projects";
import { copy } from "@/lib/copy";
import { projectsCopy } from "@/lib/copy-projects";
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
}

export function OverviewTab({ summary, versions, catalog, timeZone }: Props) {
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
      <ProjectDetails project={project} />
      <ProjectSkills projectId={project.id} skills={summary.skills} catalog={catalog} />

      {(summary.recentEvidence.length > 0 || summary.needsReviewCount > 0) && (
        <section className="bg-card space-y-3 rounded-2xl border p-4 sm:p-5">
          {summary.needsReviewCount > 0 && (
            <p className="text-sm">
              <span className="font-medium">{copy.needsReview.label}:</span>{" "}
              {t.needsReview(summary.needsReviewCount)}.{" "}
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
