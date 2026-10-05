"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { evidenceCopy } from "@/lib/copy-evidence";

/** A failure while loading an evidence page keeps the app frame and offers a retry. */
export default function EvidenceError({
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
      title={evidenceCopy.error.title}
      description={evidenceCopy.error.description}
      action={<Button onClick={reset}>{evidenceCopy.error.retry}</Button>}
      className="mt-8"
    />
  );
}
