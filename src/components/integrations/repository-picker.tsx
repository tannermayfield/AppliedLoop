"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { ApiError, apiRequest } from "@/components/learning/api-client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { RepositoryOptionDto } from "@/domain/integrations/github/repositories";
import { githubCopy } from "@/lib/copy-integrations";
import { requestCopy } from "@/lib/copy-learning";
import { ExternalLink } from "./external-link";

const copy = githubCopy.repositoryPicker;

/**
 * "Choose repository" / "Change repository": a button that opens the list of repositories the
 * student shared with the App on GitHub (loaded live when opened), to link one to the project.
 */
export function RepositoryPicker({
  label,
  variant = "default",
  projectId,
  manageUrl,
  onLinked,
}: {
  label: string;
  variant?: "default" | "outline";
  projectId: string;
  manageUrl: string | null | undefined;
  onLinked: (fullName: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [repositories, setRepositories] = useState<RepositoryOptionDto[] | null>(null);
  const [linking, setLinking] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function openPicker() {
    setOpen(true);
    setRepositories(null);
    setError(null);
    try {
      setRepositories(
        await apiRequest<RepositoryOptionDto[]>("/api/v1/integrations/github/repositories"),
      );
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : requestCopy.unexpected);
    }
  }

  async function link(repository: RepositoryOptionDto) {
    setLinking(repository.githubId);
    setError(null);
    try {
      await apiRequest(`/api/v1/projects/${projectId}/repositories`, {
        method: "POST",
        body: { githubRepositoryId: repository.githubId },
      });
      onLinked(repository.fullName);
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : requestCopy.unexpected);
    } finally {
      setLinking(null);
    }
  }

  return (
    <>
      <Button type="button" size="sm" variant={variant} onClick={() => void openPicker()}>
        {label}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{copy.description}</DialogDescription>
          </DialogHeader>
          <div
            aria-live="polite"
            aria-busy={repositories === null && !error}
            className="grid gap-2"
          >
            {repositories === null && !error && (
              <p className="text-muted-foreground flex items-center gap-2 text-sm">
                <Loader2 className="size-4 animate-spin" aria-hidden /> {copy.loading}
              </p>
            )}
            {error && (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            )}
            {repositories?.length === 0 && (
              <p className="text-muted-foreground text-sm text-pretty">{copy.empty}</p>
            )}
            {repositories && repositories.length > 0 && (
              <ul className="grid max-h-80 gap-2 overflow-y-auto">
                {repositories.map((repository) => {
                  const here = repository.linkedProjectIds.includes(projectId);
                  const busy = linking === repository.githubId;
                  return (
                    <li
                      key={repository.githubId}
                      className="flex items-center justify-between gap-3 rounded-xl border p-3"
                    >
                      <div className="flex min-w-0 flex-wrap items-center gap-2">
                        <span className="text-sm font-medium break-all">{repository.fullName}</span>
                        <Badge variant="outline">
                          {repository.private
                            ? githubCopy.repository.private
                            : githubCopy.repository.public}
                        </Badge>
                      </div>
                      {here ? (
                        <span className="text-muted-foreground text-xs">{copy.linkedHere}</span>
                      ) : (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={linking !== null}
                          aria-label={copy.linkLabel(repository.fullName)}
                          onClick={() => void link(repository)}
                        >
                          {busy && <Loader2 className="animate-spin" aria-hidden />}
                          {busy ? copy.linking : copy.link}
                        </Button>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <ExternalLink href={manageUrl} className="text-sm">
              {copy.manage}
            </ExternalLink>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
