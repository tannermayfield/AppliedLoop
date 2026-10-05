"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { learnCopy } from "@/lib/copy-learning";

/** A failure while loading Learn keeps the app frame, says what happened, and offers a retry. */
export default function LearnError({
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
      title={learnCopy.error.title}
      description={learnCopy.error.description}
      action={<Button onClick={reset}>{learnCopy.error.retry}</Button>}
      className="mt-8"
    />
  );
}
