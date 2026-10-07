"use client";

import { useState, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { GithubIcon } from "@/components/icons/github";
import { ApiError, apiRequest } from "@/components/learning/api-client";
import { formatDate } from "@/components/learning/format";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  ArtifactCandidateDto,
  GitHubArtifactDto,
  PickableArtifactType,
} from "@/domain/integrations/github/artifacts";
import { githubCopy } from "@/lib/copy-integrations";
import { requestCopy } from "@/lib/copy-learning";

const copy = githubCopy.artifactPicker;
const TYPES: PickableArtifactType[] = ["COMMIT", "PR", "FILE"];

function detailOf(item: ArtifactCandidateDto): string {
  const when = item.occurredAt ? formatDate(item.occurredAt) : null;
  const parts =
    item.type === "PR"
      ? [`#${item.number}`, item.state ? copy.prState[item.state] : null, when]
      : [item.sha?.slice(0, 7) ?? null, when];
  return parts.filter(Boolean).join(" · ");
}

/**
 * "Pick from GitHub" beside the evidence link field. Lists recent commits and pull requests of the
 * project's linked repository (or finds a file by path); choosing one stores its metadata and hands
 * the result to the form, which fills in the type and the link. Titles render as plain text.
 */
export function ArtifactPicker({
  projectId,
  repositoryName,
  onPicked,
}: {
  projectId: string;
  repositoryName: string;
  onPicked: (artifact: GitHubArtifactDto) => void;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<PickableArtifactType>("COMMIT");
  const [filter, setFilter] = useState("");
  const [path, setPath] = useState("");
  const [items, setItems] = useState<ArtifactCandidateDto[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [picking, setPicking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const endpoint = `/api/v1/projects/${projectId}/repositories/artifacts`;

  async function load(nextType: PickableArtifactType, q?: string) {
    setLoading(true);
    setError(null);
    setItems(null);
    try {
      const params = new URLSearchParams({ type: nextType, ...(q ? { q } : {}) });
      setItems(await apiRequest<ArtifactCandidateDto[]>(`${endpoint}?${params}`));
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : requestCopy.unexpected);
    } finally {
      setLoading(false);
    }
  }

  /** Commits and pull requests load when shown; a file waits for a path. */
  function show(nextType: PickableArtifactType) {
    setType(nextType);
    setFilter("");
    setItems(null);
    setError(null);
    if (nextType !== "FILE") void load(nextType);
  }

  async function pick(item: ArtifactCandidateDto) {
    setPicking(item.ref);
    setError(null);
    try {
      const artifact = await apiRequest<GitHubArtifactDto>(endpoint, {
        method: "POST",
        body: { type: item.type, ref: item.ref },
      });
      onPicked(artifact);
      setOpen(false);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : requestCopy.unexpected);
    } finally {
      setPicking(null);
    }
  }

  function findFile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (path.trim()) void load("FILE", path.trim());
  }

  const needle = filter.trim().toLowerCase();
  const visible = (items ?? []).filter(
    (item) =>
      type === "FILE" ||
      !needle ||
      item.title.toLowerCase().includes(needle) ||
      item.ref.toLowerCase().startsWith(needle.replace(/^#/, "")),
  );

  const list = (
    <div aria-live="polite" aria-busy={loading} className="grid gap-2">
      {loading && (
        <p className="text-muted-foreground flex items-center gap-2 text-sm">
          <Loader2 className="size-4 animate-spin" aria-hidden /> {copy.loading}
        </p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      )}
      {items !== null && !loading && visible.length === 0 && (
        <p className="text-muted-foreground text-sm">{copy.empty[type]}</p>
      )}
      {visible.length > 0 && (
        <ul className="grid max-h-72 gap-2 overflow-y-auto">
          {visible.map((item) => (
            <li
              key={`${item.type}:${item.ref}`}
              className="flex items-start justify-between gap-3 rounded-xl border p-3"
            >
              <div className="min-w-0 space-y-0.5">
                <p className="text-sm font-medium break-words">{item.title}</p>
                <p className="text-muted-foreground text-xs">{detailOf(item)}</p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={picking !== null}
                aria-label={copy.useLabel(item.title)}
                onClick={() => void pick(item)}
              >
                {picking === item.ref && <Loader2 className="animate-spin" aria-hidden />}
                {picking === item.ref ? copy.picking : copy.use}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          setOpen(true);
          show(type);
        }}
      >
        <GithubIcon className="size-4" aria-hidden />
        {copy.open}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{copy.title}</DialogTitle>
            <DialogDescription>{copy.description(repositoryName)}</DialogDescription>
          </DialogHeader>
          <Tabs value={type} onValueChange={(value) => show(value as PickableArtifactType)}>
            <TabsList className="w-full">
              {TYPES.map((value) => (
                <TabsTrigger key={value} value={value}>
                  {copy.tabs[value]}
                </TabsTrigger>
              ))}
            </TabsList>
            {(["COMMIT", "PR"] as const).map((value) => (
              <TabsContent key={value} value={value} className="grid gap-3 pt-2">
                <div className="grid gap-1.5">
                  <Label htmlFor={`artifact-filter-${value}`}>{copy.filterLabel[value]}</Label>
                  <Input
                    id={`artifact-filter-${value}`}
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    className="h-10 sm:h-9"
                  />
                </div>
                {list}
              </TabsContent>
            ))}
            <TabsContent value="FILE" className="grid gap-3 pt-2">
              <form onSubmit={findFile} className="grid gap-1.5">
                <Label htmlFor="artifact-file-path">{copy.fileLabel}</Label>
                <div className="flex gap-2">
                  <Input
                    id="artifact-file-path"
                    value={path}
                    onChange={(event) => setPath(event.target.value)}
                    placeholder={copy.filePlaceholder}
                    aria-describedby="artifact-file-hint"
                    maxLength={500}
                    className="h-10 sm:h-9"
                  />
                  <Button type="submit" variant="secondary" disabled={loading || !path.trim()}>
                    {copy.find}
                  </Button>
                </div>
                <p id="artifact-file-hint" className="text-muted-foreground text-xs">
                  {copy.fileStart}
                </p>
              </form>
              {list}
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>
    </>
  );
}
