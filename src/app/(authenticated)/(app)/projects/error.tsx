"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { projectsCopy } from "@/lib/copy-projects";

/** A failure while loading a project page keeps the app frame and offers a retry. */
export default function ProjectsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <EmptyState
      icon={TriangleAlert}
      title={projectsCopy.error.title}
      description={projectsCopy.error.description}
      action={<Button onClick={reset}>{projectsCopy.error.retry}</Button>}
      className="mt-8"
    />
  );
}
