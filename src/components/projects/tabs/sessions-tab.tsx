"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Hammer, ListChecks, Target } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { ModeBadge } from "@/components/mode-badge";
import { api } from "@/components/sessions/api";
import { Button } from "@/components/ui/button";
import type { SessionStatus, SessionType } from "@/lib/db/schema/enums";
import { BUILD_COPY } from "@/lib/copy-build";

const t = BUILD_COPY.sessionsTab;
const LIMIT = 50;

/** The fields this list reads from GET /api/v1/sessions (dates arrive as ISO strings). */
interface SessionRow {
  id: string;
  type: SessionType;
  status: SessionStatus;
  goal: string;
  conceptName: string | null;
  startedAt: string;
}

type State =
  { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; items: SessionRow[] };

/** This project's Apply and Build sessions, newest first. */
export function SessionsTab({ projectId }: { projectId: string }) {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const query = new URLSearchParams({ projectId, limit: String(LIMIT) });
    api<SessionRow[]>(`/api/v1/sessions?${query}`).then((result) => {
      if (cancelled) return;
      setState(
        result.ok
          ? { kind: "ready", items: result.data }
          : { kind: "error", message: result.message },
      );
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const actions = (
    <div className="flex flex-wrap gap-2">
      <Button asChild variant="outline">
        <Link href={`/apply/new?projectId=${projectId}`}>
          <Target aria-hidden />
          {t.startApply}
        </Link>
      </Button>
      <Button asChild variant="outline">
        <Link href={`/build/new?projectId=${projectId}`}>
          <Hammer aria-hidden />
          {t.startBuild}
        </Link>
      </Button>
    </div>
  );

  if (state.kind === "ready" && state.items.length === 0) {
    return (
      <EmptyState icon={ListChecks} title={t.empty} description={t.emptyBody} action={actions} />
    );
  }

  const date = new Intl.DateTimeFormat("en-US", { dateStyle: "medium" });
  return (
    <section
      aria-labelledby="sessions-heading"
      aria-busy={state.kind === "loading"}
      className="space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="sessions-heading" className="font-display text-xl font-semibold">
          {t.heading}
        </h2>
        {actions}
      </div>
      <div aria-live="polite">
        {state.kind === "loading" && <p className="text-muted-foreground text-sm">{t.loading}</p>}
        {state.kind === "error" && <p className="text-destructive text-sm">{state.message}</p>}
      </div>
      {state.kind === "ready" && (
        <>
          <ul className="bg-card divide-y rounded-2xl border px-4 sm:px-5">
            {state.items.map((session) => (
              <li
                key={session.id}
                className="flex flex-wrap items-center justify-between gap-3 py-3"
              >
                <div className="min-w-0 space-y-1">
                  <Link
                    href={`/sessions/${session.id}`}
                    className="block font-medium underline-offset-4 hover:underline"
                  >
                    {session.goal || session.conceptName || t.untitled}
                  </Link>
                  <p className="text-muted-foreground text-xs">
                    {t.status[session.status]} ·{" "}
                    {t.started(date.format(new Date(session.startedAt)))}
                  </p>
                </div>
                <ModeBadge mode={session.type} showLabel={false} />
              </li>
            ))}
          </ul>
          {state.items.length >= LIMIT && <p className="text-muted-foreground text-xs">{t.more}</p>}
        </>
      )}
    </section>
  );
}
