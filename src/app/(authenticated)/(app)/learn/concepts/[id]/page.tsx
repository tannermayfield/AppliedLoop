import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Target } from "lucide-react";
import { formatDate } from "@/components/learning/format";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { ConceptEditor } from "@/components/learning/concept-editor";
import { ConceptSkills } from "@/components/learning/concept-skills";
import { orNotFound } from "@/components/learning/or-not-found";
import { StageMenu } from "@/components/learning/stage-menu";
import { StageTimeline } from "@/components/learning/stage-timeline";
import { ConceptNeedsReview } from "@/components/needs-review/concept-needs-review";
import { NeedsReviewBadge } from "@/components/needs-review/needs-review-badge";
import { listEvidence } from "@/domain/evidence/evidence";
import { getConcept } from "@/domain/learning/concepts";
import { listDebt } from "@/domain/learning/debt";
import { listSkills } from "@/domain/learning/skills";
import { listSources } from "@/domain/learning/sources";
import { getMe } from "@/domain/identity/me";
import { getPageContext } from "@/lib/app-context";
import { evidenceCopy } from "@/lib/copy-evidence";
import { STAGE_DESCRIPTIONS, learnCopy } from "@/lib/copy-learning";
import { needsReviewFlow } from "@/lib/copy-needs-review";

export const metadata: Metadata = { title: "Concept" };

const copy = learnCopy.concept;

function Section({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="bg-card space-y-4 rounded-2xl border p-4 sm:p-5">
      <h2 id={id} className="font-display text-xl font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

export default async function ConceptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getPageContext();

  const [concept, me, sourcePage, catalog] = await Promise.all([
    orNotFound(getConcept(c, id)),
    getMe(c),
    listSources(c, { active: "all", limit: 100 }),
    listSkills(c),
  ]);
  // Only reached for the caller's own concept (getConcept above 404s otherwise).
  const [evidence, openDebt] = await Promise.all([
    listEvidence(c, { conceptId: concept.id, limit: 50 }),
    // The concept's OPEN or PLANNED Needs Review item, if the student added it there.
    listDebt(c, { conceptId: concept.id, limit: 1 }).then((page) => page.items[0] ?? null),
  ]);
  const initialStage = concept.history[0]?.fromStage ?? concept.stage;
  // Practice it where it came up when we know (the same link the Needs Review list uses).
  const applyHref = `/apply/new?conceptId=${concept.id}${openDebt?.projectId ? `&projectId=${openDebt.projectId}` : ""}`;

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            <Link
              href="/learn"
              className="hover:text-foreground inline-flex items-center gap-1 underline-offset-4 hover:underline"
            >
              <ArrowLeft className="size-3.5" aria-hidden />
              {copy.back}
            </Link>
            {openDebt && <NeedsReviewBadge />}
          </span>
        }
        title={concept.name}
        description={concept.sourceTitle ?? undefined}
        actions={
          <Button asChild>
            <Link href={applyHref}>
              <Target aria-hidden />
              {copy.startApply}
            </Link>
          </Button>
        }
      />

      <div className="max-w-2xl space-y-6">
        {openDebt && (
          <Section id="needs-review-heading" title={needsReviewFlow.concept.heading}>
            <ConceptNeedsReview
              debtId={openDebt.id}
              conceptName={concept.name}
              projectName={openDebt.projectName}
            />
          </Section>
        )}

        <Section id="stage-heading" title={copy.stageHeading}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <p className="text-muted-foreground max-w-sm text-sm text-pretty">
              {STAGE_DESCRIPTIONS[concept.stage]}
            </p>
            <StageMenu
              key={concept.stage}
              conceptId={concept.id}
              conceptName={concept.name}
              stage={concept.stage}
            />
          </div>
          <p className="text-muted-foreground text-xs">{copy.stageHint}</p>
        </Section>

        <Section id="details-heading" title={copy.detailsHeading}>
          <ConceptEditor
            key={`${concept.name}|${concept.description}|${concept.notes}|${concept.learningSourceId}`}
            concept={{
              id: concept.id,
              name: concept.name,
              description: concept.description,
              notes: concept.notes,
              learningSourceId: concept.learningSourceId,
            }}
            sources={sourcePage.items.map((source) => ({
              id: source.id,
              title: source.title,
              active: source.active,
            }))}
          />
        </Section>

        <Section id="skills-heading" title={copy.skillsHeading}>
          <ConceptSkills conceptId={concept.id} skills={concept.skills} catalog={catalog} />
        </Section>

        <Section id="evidence-heading" title={evidenceCopy.concept.heading}>
          {evidence.items.length === 0 ? (
            <p className="text-muted-foreground text-sm">{evidenceCopy.concept.empty}</p>
          ) : (
            <ul className="space-y-2">
              {evidence.items.map((item) => (
                <li key={item.id} className="text-sm">
                  <Link href={`/evidence/${item.id}`} className="underline underline-offset-4">
                    {item.title}
                  </Link>
                  <span className="text-muted-foreground">
                    {" "}
                    · {item.projectName} ·{" "}
                    {formatDate(item.createdAt, { timeZone: me.profile.timezone })}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Button asChild variant="outline" size="sm">
            <Link href={`/evidence/new?conceptId=${concept.id}`}>{evidenceCopy.concept.add}</Link>
          </Button>
        </Section>

        <Section id="history-heading" title={copy.historyHeading}>
          {concept.history.length === 0 && (
            <p className="text-muted-foreground text-sm">{copy.historyEmpty}</p>
          )}
          <StageTimeline
            addedAt={concept.capturedAt}
            initialStage={initialStage}
            history={concept.history}
            timeZone={me.profile.timezone}
          />
        </Section>
      </div>
    </>
  );
}
