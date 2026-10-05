import type { Metadata } from "next";
import Link from "next/link";
import { Layers } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { BuildStartForm } from "@/components/extraction/build/build-start-form";
import { ModeBadge } from "@/components/mode-badge";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { listBuildProjects } from "@/domain/sessions/build/build";
import { getPageContext } from "@/lib/app-context";
import { BUILD_COPY } from "@/lib/copy-build";

export const metadata: Metadata = { title: "Start a Build session" };

const t = BUILD_COPY.start;

export default async function NewBuildPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const c = await getPageContext();
  const projects = await listBuildProjects(c);
  const wanted = typeof query.projectId === "string" ? query.projectId : "";
  // Only preselect a project that is really the caller's (and not archived).
  const projectId = projects.some((project) => project.id === wanted)
    ? wanted
    : projects.length === 1
      ? projects[0].id
      : "";

  return (
    <>
      <PageHeader
        eyebrow={<ModeBadge mode="BUILD" />}
        title={t.title}
        description={t.description}
      />
      {projects.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={t.noProjects}
          description={t.noProjectsBody}
          action={
            <Button asChild>
              <Link href="/projects/new">{t.goProjects}</Link>
            </Button>
          }
        />
      ) : (
        <BuildStartForm projects={projects} projectId={projectId} />
      )}
    </>
  );
}
