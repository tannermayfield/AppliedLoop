"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { GithubIcon } from "@/components/icons/github";
import { ApiError, apiRequest } from "@/components/learning/api-client";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { GitHubConnectionDto } from "@/domain/integrations/github/integration";
import { githubCopy } from "@/lib/copy-integrations";
import { requestCopy } from "@/lib/copy-learning";
import type { GitHubConnectNotice } from "@/lib/integrations/github/types";
import { ConnectNotice, connectHref } from "./connect-notice";
import { ExternalLink } from "./external-link";

const copy = githubCopy.connection;

/**
 * The student's GitHub connection: status, Connect, and Disconnect (with a confirmation).
 * Drop it into a server page:
 *
 *   const { github } = await getIntegrations(c);           // @/domain/integrations/github/integration
 *   <GitHubConnectionCard status={github} returnTo="/settings"
 *     notice={parseGitHubNotice((await searchParams).github)} />   // ./connect-notice
 *
 * Never shows a token: there is none to show (the App mints short-lived ones server-side).
 */
export function GitHubConnectionCard({
  status,
  returnTo = "/settings",
  notice = null,
}: {
  status: GitHubConnectionDto;
  /** Where GitHub sends the student back to after connecting. */
  returnTo?: string;
  notice?: GitHubConnectNotice | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function disconnect() {
    setPending(true);
    setResult(null);
    try {
      await apiRequest("/api/v1/integrations/github", { method: "DELETE" });
      setResult({ ok: true, text: copy.disconnected });
      router.refresh();
    } catch (caught) {
      setResult({
        ok: false,
        text: caught instanceof ApiError ? caught.message : requestCopy.unexpected,
      });
    } finally {
      setPending(false);
    }
  }

  const live =
    status.configured && (status.status === "CONNECTED" || status.status === "SUSPENDED");

  return (
    <section
      aria-labelledby="github-connection-heading"
      className="bg-card space-y-3 rounded-2xl border p-4 sm:p-5"
    >
      <h2
        id="github-connection-heading"
        className="font-display flex items-center gap-2 text-xl font-semibold"
      >
        <GithubIcon className="size-5" aria-hidden />
        {copy.heading}
      </h2>
      <ConnectNotice notice={notice} />

      {!status.configured ? (
        <p className="text-muted-foreground text-sm text-pretty">{githubCopy.notConfigured}</p>
      ) : live ? (
        <div className="space-y-3">
          {status.account && (
            <p className="text-sm font-medium break-words">
              {copy.connectedAs(status.account.login, status.account.type)}
            </p>
          )}
          {status.status === "SUSPENDED" && (
            <p role="status" className="text-muted-foreground text-sm text-pretty">
              {copy.suspended}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <ExternalLink href={status.manageUrl} className="text-sm">
              {copy.manage}
            </ExternalLink>
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button type="button" variant="outline" size="sm" disabled={pending}>
                  {pending && <Loader2 className="animate-spin" aria-hidden />}
                  {pending ? copy.disconnecting : copy.disconnect}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{copy.disconnectTitle}</AlertDialogTitle>
                  <AlertDialogDescription>{copy.disconnectBody}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{copy.cancel}</AlertDialogCancel>
                  <AlertDialogAction variant="destructive" onClick={() => void disconnect()}>
                    {copy.disconnect}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-muted-foreground text-sm text-pretty">
            {status.status === "DISCONNECTED" ? copy.disconnectedNote : copy.description}
          </p>
          <Button asChild>
            <a href={connectHref(returnTo)}>
              <GithubIcon className="size-4" aria-hidden />
              {copy.connect}
            </a>
          </Button>
          <p className="text-muted-foreground text-xs text-pretty">{copy.connectHint}</p>
        </div>
      )}

      <div aria-live="polite" className="text-sm">
        {result && (
          <p
            role={result.ok ? undefined : "alert"}
            className={result.ok ? "text-success" : "text-destructive"}
          >
            {result.text}
          </p>
        )}
      </div>
    </section>
  );
}
