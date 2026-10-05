"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { todayCopy } from "@/lib/copy-today";

/** A failure while loading Today keeps the app frame, says what happened, and offers a retry. */
export default function TodayError({
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
      title={todayCopy.error.title}
      description={todayCopy.error.description}
      action={<Button onClick={reset}>{todayCopy.error.retry}</Button>}
      className="mt-8"
    />
  );
}
