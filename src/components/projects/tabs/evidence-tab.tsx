import Link from "next/link";
import { BadgeCheck, Plus } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { EvidenceList } from "@/components/evidence/evidence-list";
import { Button } from "@/components/ui/button";
import { listEvidence } from "@/domain/evidence/evidence";
import { getMe } from "@/domain/identity/me";
import { getPageContext } from "@/lib/app-context";
import { evidenceCopy } from "@/lib/copy-evidence";

const copy = evidenceCopy.tab;

/** The project's Evidence tab: its evidence grouped by skill, with an Add evidence action. */
export async function EvidenceTab({ projectId }: { projectId: string }) {
  const c = await getPageContext();
  const [{ items }, me] = await Promise.all([listEvidence(c, { projectId, limit: 100 }), getMe(c)]);
  const addHref = `/evidence/new?projectId=${projectId}`;

  if (items.length === 0) {
    return (
      <EmptyState
        icon={BadgeCheck}
        title={copy.emptyTitle}
        description={copy.emptyDescription}
        action={
          <Button asChild>
            <Link href={addHref}>{copy.add}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-xl font-semibold">{copy.heading}</h2>
        <Button asChild>
          <Link href={addHref}>
            <Plus aria-hidden /> {copy.add}
          </Link>
        </Button>
      </div>
      <EvidenceList items={items} timeZone={me.profile.timezone} />
    </div>
  );
}
