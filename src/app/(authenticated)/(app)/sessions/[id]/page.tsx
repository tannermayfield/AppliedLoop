import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { listDebt } from "@/domain/learning/debt";
import { getSession } from "@/domain/sessions/sessions";
import { ApplyView } from "@/components/sessions/apply-view";
import { BuildView } from "@/components/sessions/build-view";
import { getPageContext } from "@/lib/app-context";
import { getEnv } from "@/lib/env";
import { NotFoundError } from "@/lib/errors";

export const metadata: Metadata = { title: "Session" };

/** Renders by the session's PERSISTED type: APPLY → tutor mode, BUILD → Build mode. */
export default async function SessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const c = await getPageContext();
  let session;
  try {
    session = await getSession(c, id);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  if (session.type !== "APPLY") return <BuildView session={session} />;

  // A finished Apply session whose concept is in Needs Review: the completion card can ask whether
  // to mark it resolved once the student confirms the concept as Applied (journeys audit F-07).
  const openDebt =
    session.status === "COMPLETED" && session.concept
      ? (await listDebt(c, { conceptId: session.concept.id, limit: 1 })).items[0]
      : undefined;

  return (
    <ApplyView
      key={`${session.id}:${session.status}`}
      session={session}
      aiMode={getEnv().aiMode}
      openDebtId={openDebt?.id ?? null}
    />
  );
}
