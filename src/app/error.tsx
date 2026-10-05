"use client";

import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function GlobalError({
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
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-display text-3xl font-semibold">Something went wrong</h1>
      <p className="text-muted-foreground">
        That one is on us, and your work is saved. Try again, and if it keeps happening, reload the
        page.
      </p>
      {error.digest && <p className="text-muted-foreground text-xs">Reference: {error.digest}</p>}
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
