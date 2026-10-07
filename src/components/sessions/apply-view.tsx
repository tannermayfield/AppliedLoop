import Link from "next/link";
import type { SessionDetailDto } from "@/domain/sessions/sessions";
import { ModeBadge } from "@/components/mode-badge";
import { StageBadge } from "@/components/stage-badge";
import { Button } from "@/components/ui/button";
import type { AiMode } from "@/lib/env";
import { MODE_COPY } from "@/lib/copy";
import { APPLY_COPY } from "@/lib/copy-sessions";
import { CONCEPT_STAGES } from "@/lib/db/schema/enums";
import { ApplyWorkspace } from "./apply-workspace";
import { ChallengeCard } from "./challenge-card";
import { CompletionCard } from "./completion-card";
import { DeleteSessionButton } from "./delete-session-button";
import { PlainWithCode } from "./markdown";
import { Thread } from "./thread";

const t = APPLY_COPY.session;

/**
 * An APPLY session (teal tutor mode). ACTIVE sessions are interactive; ended ones are read-only.
 * `openDebtId` is the session concept's open Needs Review item, if any (a plain id for the client).
 */
export function ApplyView({
  session,
  aiMode,
  openDebtId = null,
}: {
  session: SessionDetailDto;
  aiMode: AiMode;
  openDebtId?: string | null;
}) {
  const active = session.status === "ACTIVE";
  const opportunity = session.opportunity;
  const tutorUnavailable = !session.project.aiEnabled
    ? t.tutorOffProject(session.project.name)
    : aiMode === "off"
      ? t.tutorOffApp
      : null;
  const belowApplied =
    session.concept !== null &&
    CONCEPT_STAGES.indexOf(session.concept.stage) < CONCEPT_STAGES.indexOf("APPLIED");
  const reflection = session.reflection;

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <ModeBadge mode="APPLY" />
          {!active && (
            <span className="bg-muted rounded-full px-2.5 py-1 text-xs font-medium">
              {t.status[session.status]}
            </span>
          )}
        </div>
        <h1 className="font-display text-2xl font-semibold text-balance sm:text-3xl">
          {t.concept(session.concept?.name ?? null, session.project.name)}
        </h1>
        <p className="text-muted-foreground flex flex-wrap items-center gap-2 text-sm">
          {session.concept && <StageBadge stage={session.concept.stage} />}
          {MODE_COPY.APPLY.blurb}
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
        <div className="order-2 min-w-0 space-y-6 lg:order-1">
          {active ? (
            <ApplyWorkspace
              sessionId={session.id}
              initialMessages={session.messages}
              initialHintLevel={session.hintLevel}
              tutorUnavailable={tutorUnavailable}
            />
          ) : (
            <>
              {session.status === "COMPLETED" && (
                <CompletionCard
                  sessionId={session.id}
                  projectId={session.project.id}
                  concept={session.concept}
                  suggestApplied={belowApplied}
                  openDebtId={openDebtId}
                />
              )}
              {session.status === "SWITCHED" && session.switchedToSessionId && (
                <Button asChild variant="outline">
                  <Link href={`/sessions/${session.switchedToSessionId}`}>{t.openBuild}</Link>
                </Button>
              )}
              {reflection && (
                <section className="bg-card space-y-3 rounded-2xl border p-4">
                  <h2 className="font-medium">{t.reflection}</h2>
                  {(
                    [
                      [t.qImplemented, reflection.implemented],
                      [t.qUnderstanding, reflection.understandingChange],
                      [t.qExplain, reflection.explanation],
                    ] as const
                  ).map(([question, answer]) =>
                    answer ? (
                      <div key={question}>
                        <h3 className="text-muted-foreground text-xs font-semibold">{question}</h3>
                        <PlainWithCode text={answer} />
                      </div>
                    ) : null,
                  )}
                </section>
              )}
              <Thread messages={session.messages} />
              <div className="flex justify-end border-t pt-4">
                <DeleteSessionButton sessionId={session.id} />
              </div>
            </>
          )}
        </div>
        <aside className="order-1 lg:sticky lg:top-6 lg:order-2">
          {opportunity ? (
            <ChallengeCard
              sessionId={session.id}
              title={opportunity.title}
              task={opportunity.task}
              rationale={opportunity.rationale}
              successCriteria={opportunity.successCriteria}
              interactive={active}
            />
          ) : (
            <p className="text-muted-foreground rounded-2xl border p-4 text-sm">{session.goal}</p>
          )}
        </aside>
      </div>
    </div>
  );
}
