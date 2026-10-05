import Link from "next/link";
import type { ProjectDto } from "@/domain/projects/projects";
import { projectsCopy } from "@/lib/copy-projects";
import { ProjectStatusBadge } from "./project-status-badge";

const MAX_CHIPS = 4;

function Chips({
  label,
  items,
  variant,
}: {
  label: string;
  items: string[];
  variant: "tech" | "skill";
}) {
  if (items.length === 0) return null;
  const shown = items.slice(0, MAX_CHIPS);
  const hidden = items.length - shown.length;
  return (
    <ul aria-label={label} className="flex flex-wrap gap-1.5">
      {shown.map((item) => (
        <li
          key={item}
          className={
            variant === "tech"
              ? "text-muted-foreground rounded-full border px-2.5 py-0.5 text-xs"
              : "bg-secondary text-secondary-foreground rounded-full px-2.5 py-0.5 text-xs"
          }
        >
          {item}
        </li>
      ))}
      {hidden > 0 && (
        <li className="text-muted-foreground px-1 py-0.5 text-xs">
          {projectsCopy.card.skillsMore(hidden)}
        </li>
      )}
    </ul>
  );
}

/** One project on the Projects page: where it stands and what it is built with. */
export function ProjectCard({ project }: { project: ProjectDto }) {
  return (
    <article className="bg-card hover:border-foreground/25 focus-within:ring-ring/50 relative flex flex-col gap-3 rounded-2xl border p-4 transition-colors focus-within:ring-3 sm:p-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-display min-w-0 text-xl font-semibold text-balance">
          {/* The link's box covers the whole card, so the card is one big click target. */}
          <Link
            href={`/projects/${project.id}`}
            aria-label={projectsCopy.card.open(project.name)}
            className="outline-none after:absolute after:inset-0 after:rounded-2xl"
          >
            {project.name}
          </Link>
        </h2>
        <ProjectStatusBadge status={project.status} />
      </div>

      <div className="text-sm">
        <p className="text-muted-foreground">{projectsCopy.card.milestone}</p>
        <p
          className={project.currentMilestone ? "font-medium text-pretty" : "text-muted-foreground"}
        >
          {project.currentMilestone || projectsCopy.card.noMilestone}
        </p>
      </div>

      {project.problemStatement && (
        <p className="text-muted-foreground line-clamp-2 text-sm text-pretty">
          {project.problemStatement}
        </p>
      )}

      <Chips label="Tech and tools" items={project.techStack} variant="tech" />
      <Chips label="Skills" items={project.skills.map((skill) => skill.name)} variant="skill" />
    </article>
  );
}
