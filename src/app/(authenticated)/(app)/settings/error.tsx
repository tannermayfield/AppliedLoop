"use client";

import { useEffect } from "react";
import { TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { settingsCopy } from "@/lib/copy-settings";

/** A failure while loading Settings keeps the app frame and offers a retry. */
export default function SettingsError({
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
      title={settingsCopy.error.title}
      description={settingsCopy.error.description}
      action={<Button onClick={reset}>{settingsCopy.error.retry}</Button>}
      className="mt-8"
    />
  );
}
