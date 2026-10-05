import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { learnCopy } from "@/lib/copy-learning";

// Also what a student sees for another student's concept id: not found, never "forbidden".
export default function LearnNotFound() {
  return (
    <EmptyState
      icon={SearchX}
      title={learnCopy.notFound.title}
      description={learnCopy.notFound.description}
      action={
        <Button asChild>
          <Link href="/learn">{learnCopy.notFound.action}</Link>
        </Button>
      }
      className="mt-8"
    />
  );
}
