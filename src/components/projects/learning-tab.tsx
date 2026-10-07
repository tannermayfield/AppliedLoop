import Link from "next/link";
import { Link2, Target } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { StageBadge } from "@/components/stage-badge";
import { Button } from "@/components/ui/button";
import type { ConceptDto } from "@/domain/learning/concepts";
import { projectsCopy } from "@/lib/copy-projects";

const t = projectsCopy.learning;

/**
 * Concepts that share a skill with the project. The project's Needs Review queue is rendered above
 * this by the page, once: it used to be a count card plus the list under the same heading (journeys
 * audit F-15).
 */
export function LearningTab({
  projectId,
  concepts,
}: {
  projectId: string;
  concepts: ConceptDto[];
}) {
  return (
    <section aria-labelledby="linked-heading" className="space-y-3">
      <div>
        <h2 id="linked-heading" className="font-display text-xl font-semibold">
          {t.heading}
        </h2>
        <p className="text-muted-foreground text-sm">{t.description}</p>
      </div>
      {concepts.length === 0 ? (
        <EmptyState
          icon={Link2}
          title={t.empty.title}
          description={t.empty.description}
          action={
            <Button asChild>
              <Link href={`/projects/${projectId}?tab=overview`}>{t.empty.action}</Link>
            </Button>
          }
        />
      ) : (
        <ul className="bg-card divide-y rounded-2xl border px-4 sm:px-5">
          {concepts.map((concept) => (
            <li key={concept.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <Link
                  href={`/learn/concepts/${concept.id}`}
                  className="font-medium underline-offset-4 hover:underline"
                >
                  {concept.name}
                </Link>
                <StageBadge stage={concept.stage} />
              </div>
              <Button asChild variant="outline" size="sm">
                <Link
                  href={`/apply/new?projectId=${projectId}&conceptId=${concept.id}`}
                  aria-label={t.applyLabel(concept.name)}
                >
                  <Target aria-hidden />
                  {t.apply}
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
