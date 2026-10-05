import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { evidenceCopy } from "@/lib/copy-evidence";

// Also what a student sees for another student's evidence id: not found, never "forbidden".
export default function EvidenceNotFound() {
  return (
    <EmptyState
      icon={SearchX}
      title={evidenceCopy.notFound.title}
      description={evidenceCopy.notFound.description}
      action={
        <Button asChild>
          <Link href="/evidence">{evidenceCopy.notFound.action}</Link>
        </Button>
      }
      className="mt-8"
    />
  );
}
