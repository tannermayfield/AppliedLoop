import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { orNotFound } from "@/components/learning/or-not-found";
import { NeedsReviewList } from "@/components/needs-review/needs-review-list";
import { LearningTab } from "@/components/projects/learning-tab";
import { OverviewTab } from "@/components/projects/overview-tab";
import { ProjectHeaderActions } from "@/components/projects/project-header-actions";
import { ProjectStatusBadge } from "@/components/projects/project-status-badge";
import { parseProjectTab } from "@/components/projects/project-tab-ids";
import { ProjectTabs } from "@/components/projects/project-tabs";
import { EvidenceTab } from "@/components/projects/tabs/evidence-tab";
import { SessionsTab } from "@/components/projects/tabs/sessions-tab";
import { parseGitHubNotice } from "@/components/integrations/connect-notice";
import { getMe } from "@/domain/identity/me";
import { getIntegrations } from "@/domain/integrations/github/integration";
import { getProjectRepository } from "@/domain/integrations/github/repositories";
import { listConcepts } from "@/domain/learning/concepts";
import { listSkills } from "@/domain/learning/skills";
import { listContextVersions } from "@/domain/projects/context";
import { getProjectSummary } from "@/domain/projects/projects";
import { getPageContext } from "@/lib/app-context";

export const metadata: Metadata = { title: "Project" };

export default async function ProjectPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const query = await searchParams;
  const tab = parseProjectTab(query.tab);
  const c = await getPageContext();

  const summary = await orNotFound(getProjectSummary(c, id));
  const { project } = summary;

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            <Link
              href="/projects"
              className="hover:text-foreground inline-flex items-center gap-1 underline-offset-4 hover:underline"
            >
              <ArrowLeft className="size-3.5" aria-hidden />
              Projects
            </Link>
            <ProjectStatusBadge status={project.status} />
          </span>
        }
        title={project.name}
        actions={
          <ProjectHeaderActions projectId={project.id} archived={project.status === "ARCHIVED"} />
        }
        className="mb-6"
      />

      <ProjectTabs projectId={project.id} active={tab} />

      {tab === "overview" && (
        <OverviewTab
          summary={summary}
          versions={await listContextVersions(c, id)}
          catalog={await listSkills(c)}
          timeZone={(await getMe(c)).profile.timezone}
          github={(await getIntegrations(c)).github}
          repository={await getProjectRepository(c, id)}
          githubNotice={parseGitHubNotice(query.github)}
        />
      )}
      {tab === "learning" && (
        <div className="space-y-8">
          <LearningTab
            projectId={project.id}
            concepts={(await listConcepts(c, { projectId: id, limit: 100 })).items}
            needsReviewCount={summary.needsReviewCount}
          />
          <NeedsReviewList projectId={project.id} />
        </div>
      )}
      {tab === "evidence" && <EvidenceTab projectId={project.id} />}
      {tab === "sessions" && <SessionsTab projectId={project.id} />}
    </>
  );
}
