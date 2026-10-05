import type { ConceptDto } from "@/domain/learning/concepts";
import { learnCopy } from "@/lib/copy-learning";
import { ConceptRow } from "./concept-row";
import type { ConceptGroup } from "./concept-groups";

interface Props {
  groups: ConceptGroup<ConceptDto>[];
  timeZone: string;
}

function ConceptList({ concepts, timeZone }: { concepts: ConceptDto[]; timeZone: string }) {
  return (
    <ul className="divide-y">
      {concepts.map((concept) => (
        <ConceptRow key={concept.id} concept={concept} timeZone={timeZone} />
      ))}
    </ul>
  );
}

/** The student's concepts grouped by source, "Recently learned" first within each group. */
export function ConceptGroupsView({ groups, timeZone }: Props) {
  return (
    <div className="space-y-6">
      {groups.map((group) => {
        const headingId = `concept-group-${group.key}`;
        return (
          <section
            key={group.key}
            aria-labelledby={headingId}
            className="bg-card rounded-2xl border px-4 py-4 sm:px-5"
          >
            <header className="mb-1 space-y-0.5">
              <h2 id={headingId} className="font-display text-xl font-semibold text-balance">
                {group.title || learnCopy.groups.noSource}
              </h2>
              <p className="text-muted-foreground text-sm">
                {[
                  group.subtitle,
                  group.archived ? learnCopy.groups.archivedSource : null,
                  learnCopy.groups.conceptCount(group.total),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </header>

            {group.recent.length > 0 && (
              <div>
                <h3 className="text-muted-foreground mt-3 text-xs font-medium tracking-wide uppercase">
                  {learnCopy.groups.recent}
                </h3>
                <ConceptList concepts={group.recent} timeZone={timeZone} />
              </div>
            )}
            {group.earlier.length > 0 && (
              <div>
                {group.recent.length > 0 && (
                  <h3 className="text-muted-foreground mt-3 text-xs font-medium tracking-wide uppercase">
                    {learnCopy.groups.earlier}
                  </h3>
                )}
                <ConceptList concepts={group.earlier} timeZone={timeZone} />
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
