import Link from "next/link";
import { Hammer, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { projectsCopy } from "@/lib/copy-projects";

/** Start Apply (teal, tutor mode) and Start Build Session (amber): same tokens as ModeBadge. */
export function ProjectHeaderActions({
  projectId,
  archived,
}: {
  projectId: string;
  archived: boolean;
}) {
  if (archived) {
    return (
      <p className="text-muted-foreground max-w-xs text-sm">{projectsCopy.actions.archivedNote}</p>
    );
  }
  return (
    <>
      <Button
        asChild
        variant="outline"
        className="bg-apply-soft text-apply-ink border-apply/30 hover:bg-apply-soft/60"
      >
        <Link href={`/apply/new?projectId=${projectId}`}>
          <Target aria-hidden />
          {projectsCopy.actions.startApply}
        </Link>
      </Button>
      <Button
        asChild
        variant="outline"
        className="bg-build-soft text-build-ink border-build/40 hover:bg-build-soft/60"
      >
        <Link href={`/build/new?projectId=${projectId}`}>
          <Hammer aria-hidden />
          {projectsCopy.actions.startBuild}
        </Link>
      </Button>
    </>
  );
}
