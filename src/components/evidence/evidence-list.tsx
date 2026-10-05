import type { EvidenceDto } from "@/domain/evidence/evidence";
import { evidenceCopy } from "@/lib/copy-evidence";
import { EvidenceCard } from "./evidence-card";
import { groupBySkill } from "./group";

/** Evidence grouped by skill, like the wireframe in docs/SPEC.md §3. */
export function EvidenceList({ items, timeZone }: { items: EvidenceDto[]; timeZone: string }) {
  const groups = groupBySkill(items);
  return (
    <div className="space-y-8">
      {groups.map((group) => (
        <section
          key={group.skillId ?? "none"}
          aria-labelledby={`skill-${group.skillId ?? "none"}`}
          className="space-y-3"
        >
          <h2
            id={`skill-${group.skillId ?? "none"}`}
            className="font-display text-xl font-semibold"
          >
            {group.skillName ?? evidenceCopy.list.ungrouped}
          </h2>
          <ul className="grid gap-3 md:grid-cols-2">
            {group.items.map((item) => (
              <EvidenceCard key={item.id} item={item} timeZone={timeZone} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
