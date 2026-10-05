import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen, Layers } from "lucide-react";
import { listOpenOpportunities } from "@/domain/sessions/apply/opportunities";
import { listConceptChoices, listProjectChoices } from "@/domain/sessions/loaders";
import { EmptyState } from "@/components/empty-state";
import { ModeBadge } from "@/components/mode-badge";
import { PageHeader } from "@/components/page-header";
import { ApplyPicker } from "@/components/sessions/apply-picker";
import { Button } from "@/components/ui/button";
import { getPageContext } from "@/lib/app-context";
import { APPLY_COPY } from "@/lib/copy-sessions";
import { getEnv } from "@/lib/env";

export const metadata: Metadata = { title: "Start an Apply session" };

const t = APPLY_COPY.picker;

export default async function NewApplyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const c = await getPageContext();
  const [concepts, projects] = await Promise.all([listConceptChoices(c), listProjectChoices(c)]);
  const pick = (key: string) => (typeof query[key] === "string" ? (query[key] as string) : "");
  // Only preselect ids that are really the caller's.
  const conceptId = concepts.some((x) => x.id === pick("conceptId")) ? pick("conceptId") : "";
  const projectId = projects.some((x) => x.id === pick("projectId")) ? pick("projectId") : "";
  const existing =
    conceptId && projectId ? await listOpenOpportunities(c, { conceptId, projectId }) : [];

  return (
    <>
      <PageHeader eyebrow={<ModeBadge mode="APPLY" />} title={t.title} description={t.description} />
      {concepts.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title={t.noConcepts}
          description={t.noConceptsBody}
          action={
            <Button asChild>
              <Link href="/learn">{t.goLearn}</Link>
            </Button>
          }
        />
      ) : projects.length === 0 ? (
        <EmptyState
          icon={Layers}
          title={t.noProjects}
          description={t.noProjectsBody}
          action={
            <Button asChild>
              <Link href="/projects/new">{t.goProjects}</Link>
            </Button>
          }
        />
      ) : (
        <ApplyPicker
          concepts={concepts}
          projects={projects}
          conceptId={conceptId}
          projectId={projectId}
          existing={existing}
          aiOff={getEnv().aiMode === "off"}
        />
      )}
    </>
  );
}
