"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { GitHubConnectionDto } from "@/domain/integrations/github/integration";
import type { ProjectRepositoryDto } from "@/domain/integrations/github/repositories";
import { githubCopy } from "@/lib/copy-integrations";
import { requestCopy } from "@/lib/copy-learning";
import type { GitHubConnectNotice } from "@/lib/integrations/github/types";
import { ConnectNotice, connectHref } from "./connect-notice";
import { ExternalLink } from "./external-link";
import { RepositoryPicker } from "./repository-picker";

const copy = githubCopy.repository;

const STATE_NOTE: Partial<Record<ProjectRepositoryDto["state"], string>> = {
  REMOVED: copy.removed,
  DISCONNECTED: copy.stale,
  SUSPENDED: copy.suspended,
};

/** The project's GitHub repository on the Overview tab: connect, choose, change, unlink. */
export function RepositoryCard({
  projectId,
  github,
  repository,
  notice,
}: {
  projectId: string;
  github: GitHubConnectionDto;
  repository: ProjectRepositoryDto | null;
  notice: GitHubConnectNotice | null;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function unlink() {
    setPending(true);
    setResult(null);
    try {
      await apiRequest(`/api/v1/projects/${projectId}/repositories`, { method: "DELETE" });
      setResult({ ok: true, text: copy.unlinked });
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

  const picker = (label: string, variant: "default" | "outline") => (
    <RepositoryPicker
      label={label}
      variant={variant}
      projectId={projectId}
      manageUrl={github.manageUrl}
      onLinked={(name) => {
        setResult({ ok: true, text: copy.linked(name) });
        router.refresh();
      }}
    />
  );

  const connectButton = (
    <Button asChild size="sm">
      <a href={connectHref(`/projects/${projectId}`)}>
        <GithubIcon className="size-4" aria-hidden />
        {githubCopy.connection.connect}
      </a>
    </Button>
  );

  let body: React.ReactNode;
  if (!github.configured) {
    body = <p className="text-muted-foreground text-sm text-pretty">{githubCopy.notConfigured}</p>;
  } else if (repository) {
    const note = STATE_NOTE[repository.state];
    body = (
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium break-all">{repository.fullName}</span>
          <Badge variant="outline">{repository.private ? copy.private : copy.public}</Badge>
          <ExternalLink href={repository.htmlUrl} className="text-sm">
            {copy.openOnGitHub}
          </ExternalLink>
        </div>
        {note && (
          <p role="status" className="text-muted-foreground text-sm text-pretty">
            {note}
          </p>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {github.connected
            ? picker(copy.change, "outline")
            : github.status !== "SUSPENDED" && connectButton}
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button type="button" variant="ghost" size="sm" disabled={pending}>
                {copy.unlink}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{copy.unlinkTitle}</AlertDialogTitle>
                <AlertDialogDescription>{copy.unlinkBody}</AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{copy.cancel}</AlertDialogCancel>
                <AlertDialogAction onClick={() => void unlink()}>{copy.unlink}</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>
    );
  } else if (github.connected) {
    body = (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">{copy.none}</p>
        {picker(copy.choose, "default")}
      </div>
    );
  } else if (github.status === "SUSPENDED") {
    body = <p className="text-muted-foreground text-sm text-pretty">{copy.suspended}</p>;
  } else {
    body = (
      <div className="space-y-3">
        <p className="text-muted-foreground text-sm text-pretty">{copy.notConnected}</p>
        {connectButton}
      </div>
    );
  }

  return (
    <section
      aria-labelledby="repository-heading"
      className="bg-card space-y-3 rounded-2xl border p-4 sm:p-5"
    >
      <h2
        id="repository-heading"
        className="text-muted-foreground flex items-center gap-2 text-sm font-medium"
      >
        <GithubIcon className="size-4" aria-hidden />
        {copy.heading}
      </h2>
      <ConnectNotice notice={notice} />
      {body}
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
