import type { Metadata } from "next";
import { notFound } from "next/navigation";
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

  return session.type === "APPLY" ? (
    <ApplyView key={`${session.id}:${session.status}`} session={session} aiMode={getEnv().aiMode} />
  ) : (
    <BuildView session={session} />
  );
}
