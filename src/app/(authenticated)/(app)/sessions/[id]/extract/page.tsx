import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Sparkles } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ExtractionReview } from "@/components/extraction/extraction-review";
import { ManualConceptAdd } from "@/components/extraction/manual-concept-add";
import { RetryExtraction } from "@/components/extraction/retry-extraction";
import { ModeBadge } from "@/components/mode-badge";
import { PageHeader } from "@/components/page-header";
import { getExtractionForSession } from "@/domain/extraction/extract";
import { getSession } from "@/domain/sessions/sessions";
import { getPageContext } from "@/lib/app-context";
import { BUILD_COPY } from "@/lib/copy-build";
import { EXTRACTION_COPY } from "@/lib/copy-extraction";
import { NotFoundError } from "@/lib/errors";

export const metadata: Metadata = { title: "Build complete" };

const t = EXTRACTION_COPY;

export default async function ExtractPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getPageContext();
  let session;
  try {
    session = await getSession(c, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
  if (session.type !== "BUILD") notFound();
  if (session.status === "ACTIVE") redirect(`/sessions/${session.id}`);

  const extraction = await getExtractionForSession(c, session.id);
  const summary = extraction?.summary || session.summary;

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-2">
            <Link
              href={`/sessions/${session.id}`}
              className="hover:text-foreground inline-flex items-center gap-1 underline-offset-4 hover:underline"
            >
              <ArrowLeft className="size-3.5" aria-hidden />
              {session.project.name}
            </Link>
            <ModeBadge mode="BUILD" showLabel={false} />
          </span>
        }
        title={t.title}
      />

      <div className="max-w-3xl space-y-8">
        <section aria-labelledby="changed-heading" className="space-y-2">
          <h2 id="changed-heading" className="font-display text-xl font-semibold">
            {t.whatChanged}
          </h2>
          <p className="text-sm whitespace-pre-wrap">{summary || t.noSummary}</p>
          {extraction && extraction.artifactRefs.length > 0 && (
            <ul aria-label={t.artifacts} className="flex flex-wrap gap-1.5">
              {extraction.artifactRefs.map((ref, index) => (
                <li
                  key={`${ref.type}-${index}`}
                  className="bg-muted rounded-md px-2 py-0.5 font-mono text-xs break-all"
                >
                  {BUILD_COPY.session.artifactTypes[ref.type]}: {ref.value}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="concepts-heading" className="space-y-3">
          <div>
            <h2 id="concepts-heading" className="font-display text-xl font-semibold">
              {t.heading}
            </h2>
            <p className="text-muted-foreground text-sm">{t.intro}</p>
          </div>

          {!extraction ? (
            <EmptyState
              icon={Sparkles}
              title={t.noExtractionTitle}
              description={session.project.aiEnabled ? t.aiFailed : BUILD_COPY.session.aiDisabled}
              action={
                session.status === "COMPLETED" && session.project.aiEnabled ? (
                  <RetryExtraction sessionId={session.id} />
                ) : undefined
              }
            />
          ) : extraction.items.length === 0 ? (
            <EmptyState icon={Sparkles} title={t.none} description={t.noneBody} />
          ) : (
            <ExtractionReview
              extractionId={extraction.id}
              projectId={session.project.id}
              items={extraction.items}
            />
          )}
        </section>

        {/* Always available: with AI off or a failed review it is the only way in, and under a
            populated review it adds a concept the AI missed ("Add another concept"). */}
        <ManualConceptAdd
          projectId={session.project.id}
          hasCandidates={(extraction?.items.length ?? 0) > 0}
        />
      </div>
    </>
  );
}
