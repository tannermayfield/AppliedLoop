import type { EvidenceDto } from "@/domain/evidence/evidence";

export interface EvidenceGroup {
  /** The skill id, or null for evidence with no skill. */
  skillId: string | null;
  skillName: string | null;
  items: EvidenceDto[];
}

/**
 * Group evidence by skill (a piece with two skills appears under both). Groups are sorted by skill
 * name, with evidence that has no skill last. Items keep their incoming (newest first) order.
 */
export function groupBySkill(items: EvidenceDto[]): EvidenceGroup[] {
  const groups = new Map<string, EvidenceGroup>();
  const ungrouped: EvidenceDto[] = [];
  for (const item of items) {
    if (item.skills.length === 0) {
      ungrouped.push(item);
      continue;
    }
    for (const skill of item.skills) {
      const group = groups.get(skill.id) ?? { skillId: skill.id, skillName: skill.name, items: [] };
      group.items.push(item);
      groups.set(skill.id, group);
    }
  }
  const sorted = [...groups.values()].sort((a, b) =>
    (a.skillName ?? "").localeCompare(b.skillName ?? ""),
  );
  if (ungrouped.length) sorted.push({ skillId: null, skillName: null, items: ungrouped });
  return sorted;
}

/** A short, single-paragraph excerpt for list cards. */
export function excerpt(text: string, max = 180): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`;
}
