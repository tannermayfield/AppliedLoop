import Link from "next/link";
import { ArrowRight, Undo2 } from "lucide-react";
import { ContextPackCard } from "@/components/extraction/build/context-pack-card";
import { FinishForm } from "@/components/extraction/build/finish-form";
import { NotesEditor } from "@/components/extraction/build/notes-editor";
import { RetryExtraction } from "@/components/extraction/retry-extraction";
import { ModeBadge } from "@/components/mode-badge";
import { Button } from "@/components/ui/button";
import { getExtractionForSession } from "@/domain/extraction/extract";
import { buildContextPack } from "@/domain/sessions/build/context-pack";
import type { SessionDetailDto } from "@/domain/sessions/sessions";
import { getPageContext } from "@/lib/app-context";
import { BUILD_COPY } from "@/lib/copy-build";
import { MODE_COPY } from "@/lib/copy";
import { DeleteSessionButton } from "./delete-session-button";
import { SetAsideSessionButton } from "./set-aside-session-button";

const t = BUILD_COPY.session;

/**
 * Build mode (amber, AI acceleration allowed). No chat (ADR-0009): a context pack for the
 * student's own agent, notes, and Finish & Extract. Ended sessions render read-only.
 */
export async function BuildView({ session }: { session: SessionDetailDto }) {
  const c = await getPageContext();
  const active = session.status === "ACTIVE";

  return (
    <div className="space-y-6">
      <header className="space-y-3">
        <ModeBadge mode="BUILD" />
        <h1 className="font-display text-2xl font-semibold text-balance sm:text-3xl">
          {session.goal || t.noGoal}
        </h1>
        <p className="text-muted-foreground text-sm">
          <span className="sr-only">{t.project}: </span>
          <Link
            href={`/projects/${session.project.id}`}
            className="underline-offset-4 hover:underline"
          >
            {session.project.name}
          </Link>
        </p>
        {session.parentSessionId && (
          <p className="text-muted-foreground text-sm">
            <Undo2 className="mr-1 inline size-3.5" aria-hidden />
            <Link
              href={`/sessions/${session.parentSessionId}`}
              className="underline underline-offset-4"
            >
              {t.continuedFrom}
            </Link>
          </p>
        )}
        {active && (
          <p className="text-muted-foreground max-w-2xl text-sm">{MODE_COPY.BUILD.blurb}</p>
        )}
      </header>

      {active ? <ActiveBuild c={c} session={session} /> : <EndedBuild c={c} session={session} />}
    </div>
  );
}

type Ctx = Awaited<ReturnType<typeof getPageContext>>;

async function ActiveBuild({ c, session }: { c: Ctx; session: SessionDetailDto }) {
  const [codex, claude] = await Promise.all([
    buildContextPack(c, session.id, { target: "CODEX" }),
    buildContextPack(c, session.id, { target: "CLAUDE_CODE" }),
  ]);
  return (
    <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
      <ContextPackCard
        sessionId={session.id}
        projectId={session.project.id}
        included={codex.included}
        packs={{ CODEX: codex.markdown, CLAUDE_CODE: claude.markdown }}
      />
      <div className="space-y-6">
        <NotesEditor sessionId={session.id} initial={session.notes} />
        <FinishForm sessionId={session.id} />
        <div>
          <SetAsideSessionButton sessionId={session.id} copy={t} />
        </div>
      </div>
    </div>
  );
}

async function EndedBuild({ c, session }: { c: Ctx; session: SessionDetailDto }) {
  const extraction =
    session.status === "COMPLETED" ? await getExtractionForSession(c, session.id) : null;
  const statusText = session.status === "ABANDONED" ? t.readOnly.ABANDONED : t.readOnly.COMPLETED;

  return (
    <div className="max-w-3xl space-y-6">
      <p className="bg-build-soft text-build-ink rounded-xl px-4 py-3 text-sm">{statusText}</p>
      <section aria-labelledby="summary-heading" className="space-y-2">
        <h2 id="summary-heading" className="font-display text-lg font-semibold">
          {t.summaryHeading}
        </h2>
        <p className="text-sm whitespace-pre-wrap">{session.summary || t.noSummary}</p>
      </section>
      {session.notes && (
        <section aria-labelledby="notes-heading" className="space-y-2">
          <h2 id="notes-heading" className="font-display text-lg font-semibold">
            {t.notesReadOnly}
          </h2>
          <p className="text-muted-foreground text-sm whitespace-pre-wrap">{session.notes}</p>
        </section>
      )}
      {session.status === "COMPLETED" &&
        (extraction ? (
          <Button asChild>
            <Link href={`/sessions/${session.id}/extract`}>
              {t.viewExtraction}
              <ArrowRight aria-hidden />
            </Link>
          </Button>
        ) : (
          <div className="flex flex-wrap items-start gap-2">
            {session.project.aiEnabled && (
              <RetryExtraction sessionId={session.id} label={t.startExtraction} goToReview />
            )}
            <Button asChild variant="outline">
              <Link href={`/sessions/${session.id}/extract`}>{t.addManually}</Link>
            </Button>
          </div>
        ))}
      <div>
        <DeleteSessionButton sessionId={session.id} copy={t} />
      </div>
    </div>
  );
}
