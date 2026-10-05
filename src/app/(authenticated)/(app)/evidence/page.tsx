import type { Metadata } from "next";
import Link from "next/link";
import { BadgeCheck, Plus } from "lucide-react";
import { z } from "zod";
import { EmptyState } from "@/components/empty-state";
import { EvidenceFilters, type EvidenceFilterState } from "@/components/evidence/evidence-filters";
import { EvidenceList } from "@/components/evidence/evidence-list";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { listEvidence } from "@/domain/evidence/evidence";
import { getMe } from "@/domain/identity/me";
import { getPageContext } from "@/lib/app-context";
import { evidenceCopy } from "@/lib/copy-evidence";

export const metadata: Metadata = { title: "Evidence" };

const copy = evidenceCopy;
const guid = z.guid();

const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value);
const idParam = (value: string | string[] | undefined) => {
  const found = one(value);
  return found && guid.safeParse(found).success ? found : undefined;
};

export default async function EvidencePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  const state: EvidenceFilterState = {
    skillId: idParam(raw.skillId),
    projectId: idParam(raw.projectId),
    conceptId: idParam(raw.conceptId),
    search: one(raw.search)?.trim().slice(0, 100) || undefined,
  };
  const filtered = Boolean(state.skillId || state.projectId || state.conceptId || state.search);

  const c = await getPageContext();
  // The unfiltered list feeds the skill chips and the selects; the filtered one is what is shown.
  const [everything, me] = await Promise.all([listEvidence(c, { limit: 100 }), getMe(c)]);
  const shown = filtered ? await listEvidence(c, { ...state, limit: 100 }) : everything;

  const skills = new Map<string, string>();
  const projects = new Map<string, string>();
  const concepts = new Map<string, string>();
  for (const item of everything.items) {
    projects.set(item.projectId, item.projectName);
    for (const skill of item.skills) skills.set(skill.id, skill.name);
    for (const concept of item.concepts) concepts.set(concept.id, concept.name);
  }
  const options = (map: Map<string, string>) =>
    [...map].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <>
      <PageHeader
        title={copy.page.title}
        description={copy.page.description}
        actions={
          <Button asChild>
            <Link href="/evidence/new">
              <Plus aria-hidden /> {copy.page.add}
            </Link>
          </Button>
        }
      />

      {everything.items.length === 0 ? (
        <EmptyState
          icon={BadgeCheck}
          title={copy.empty.title}
          description={copy.empty.description}
          action={
            <Button asChild>
              <Link href="/evidence/new">{copy.empty.action}</Link>
            </Button>
          }
        />
      ) : (
        <>
          <EvidenceFilters
            state={state}
            skills={options(skills)}
            projects={options(projects)}
            concepts={options(concepts)}
          />
          {shown.items.length === 0 ? (
            <EmptyState icon={BadgeCheck} title={copy.empty.filtered} />
          ) : (
            <>
              <EvidenceList items={shown.items} timeZone={me.profile.timezone} />
              {shown.nextCursor && (
                <p className="text-muted-foreground mt-6 text-sm">{copy.list.more}</p>
              )}
            </>
          )}
        </>
      )}
    </>
  );
}
