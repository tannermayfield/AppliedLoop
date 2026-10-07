"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { searchCopy } from "@/lib/copy-search";

/** A failure while searching keeps the app frame, says what happened, and offers a retry. */
export default function SearchError({
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
      title={searchCopy.error.title}
      description={searchCopy.error.description}
      action={<Button onClick={reset}>{searchCopy.error.retry}</Button>}
      className="mt-8"
    />
  );
}
