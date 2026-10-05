import Link from "next/link";
import { projectsCopy } from "@/lib/copy-projects";
import { cn } from "@/lib/utils";
import { PROJECT_TAB_IDS, type ProjectTabId } from "./project-tab-ids";

/** Overview · Learning · Evidence · Sessions, as links (`?tab=`) so each view is shareable. */
export function ProjectTabs({ projectId, active }: { projectId: string; active: ProjectTabId }) {
  return (
    <nav aria-label={projectsCopy.tabs.label} className="mb-6 border-b">
      <ul className="-mb-px flex gap-1 overflow-x-auto">
        {PROJECT_TAB_IDS.map((id) => (
          <li key={id}>
            <Link
              href={`/projects/${projectId}?tab=${id}`}
              aria-current={active === id ? "page" : undefined}
              className={cn(
                "focus-visible:ring-ring/50 inline-flex h-10 items-center rounded-t-md border-b-2 px-3 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-3",
                active === id
                  ? "border-foreground text-foreground"
                  : "text-muted-foreground hover:text-foreground border-transparent",
              )}
            >
              {projectsCopy.tabs[id]}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
