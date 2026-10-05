import type { Metadata } from "next";
import Link from "next/link";
import { Layers, Plus } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ProjectCard } from "@/components/projects/project-card";
import { listProjects } from "@/domain/projects/projects";
import { getPageContext } from "@/lib/app-context";
import { projectsCopy } from "@/lib/copy-projects";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Projects" };

export default async function ProjectsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const c = await getPageContext();
  const showArchived = (await searchParams).status === "ARCHIVED";
  const projects = await listProjects(c, showArchived ? { status: "ARCHIVED" } : {});

  const filters = [
    { href: "/projects", label: projectsCopy.filters.current, active: !showArchived },
    {
      href: "/projects?status=ARCHIVED",
      label: projectsCopy.filters.archived,
      active: showArchived,
    },
  ];

  return (
    <>
      <PageHeader
        title={projectsCopy.title}
        description={projectsCopy.description}
        actions={
          <Button asChild>
            <Link href="/projects/new">
              <Plus aria-hidden />
              {projectsCopy.newProject}
            </Link>
          </Button>
        }
      />

      <nav aria-label={projectsCopy.filters.label} className="mb-4 flex gap-1">
        {filters.map((filter) => (
          <Link
            key={filter.href}
            href={filter.href}
            aria-current={filter.active ? "page" : undefined}
            className={cn(
              "focus-visible:ring-ring/50 rounded-full border px-3 py-1 text-sm outline-none focus-visible:ring-3",
              filter.active
                ? "bg-secondary text-secondary-foreground font-medium"
                : "text-muted-foreground hover:text-foreground border-transparent",
            )}
          >
            {filter.label}
          </Link>
        ))}
      </nav>

      {projects.length === 0 ? (
        showArchived ? (
          <EmptyState
            icon={Layers}
            title={projectsCopy.emptyArchived.title}
            description={projectsCopy.emptyArchived.description}
          />
        ) : (
          <EmptyState
            icon={Layers}
            title={projectsCopy.empty.title}
            description={projectsCopy.empty.description}
            action={
              <Button asChild>
                <Link href="/projects/new">{projectsCopy.empty.action}</Link>
              </Button>
            }
          />
        )
      ) : (
        <ul className="grid gap-4 md:grid-cols-2">
          {projects.map((project) => (
            <li key={project.id}>
              <ProjectCard project={project} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
