import Link from "next/link";
import { Button } from "@/components/ui/button";

// Also what a student sees for another student's id: not found, never "forbidden".
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-svh max-w-md flex-col items-center justify-center gap-4 px-6 text-center">
      <h1 className="font-display text-3xl font-semibold">We couldn&apos;t find that</h1>
      <p className="text-muted-foreground">It may have been removed, or the link may be wrong.</p>
      <Button asChild>
        <Link href="/today">Back to Today</Link>
      </Button>
    </main>
  );
}
