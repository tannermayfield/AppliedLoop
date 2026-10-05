import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { projectsCopy } from "@/lib/copy-projects";

// Also what a student sees for another student's project id: not found, never "forbidden".
export default function ProjectsNotFound() {
  return (
    <EmptyState
      icon={SearchX}
      title={projectsCopy.notFound.title}
      description={projectsCopy.notFound.description}
      action={
        <Button asChild>
          <Link href="/projects">{projectsCopy.notFound.action}</Link>
        </Button>
      }
      className="mt-8"
    />
  );
}
