"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, Pin, PinOff, Target } from "lucide-react";
import { api } from "@/components/sessions/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NEEDS_REVIEW_COPY } from "@/lib/copy-extraction";
import type { DebtPriority } from "@/lib/db/schema/enums";
import { cn } from "@/lib/utils";
import { pinnedFirst } from "./order";

const t = NEEDS_REVIEW_COPY;

/**
 * One queue row as plain strings and booleans: this crosses from a server component to this client
 * one, so it carries no dates, no functions and nothing else a render could choke on.
 */
export interface NeedsReviewItem {
  id: string;
  conceptId: string;
  conceptName: string;
  projectId: string | null;
  projectName: string | null;
  priority: DebtPriority;
  pinned: boolean;
}

/** Pinned items first, then newest first (the server's order). */
const ordered = pinnedFirst;

export function NeedsReviewItems({
  items: initial,
  showProject,
}: {
  items: NeedsReviewItem[];
  showProject: boolean;
}) {
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [status, setStatus] = useState("");

  async function patch(item: NeedsReviewItem, body: { pinned?: boolean; status?: "RESOLVED" }) {
    setBusy(item.id);
    const before = items;
    // Optimistic: resolving removes the row; pinning toggles it.
    setItems((current) =>
      body.status === "RESOLVED"
        ? current.filter((row) => row.id !== item.id)
        : current.map((row) => (row.id === item.id ? { ...row, ...body } : row)),
    );
    const result = await api(`/api/v1/learning-debt/${item.id}`, {
      method: "PATCH",
      body,
    });
    setBusy(null);
    if (!result.ok) {
      setItems(before);
      setStatus(t.updateFailed);
      return;
    }
    setStatus(body.status === "RESOLVED" ? t.resolved(item.conceptName) : "");
  }

  return (
    <div className="space-y-2">
      <p
        role="status"
        aria-live="polite"
        className={cn("text-sm", status === t.updateFailed && "text-destructive")}
      >
        {status}
      </p>
      {items.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.emptyBody}</p>
      ) : (
        <ul className="bg-card divide-y rounded-2xl border px-4 sm:px-5">
          {ordered(items).map((item) => {
            const applyHref = `/apply/new?conceptId=${item.conceptId}${item.projectId ? `&projectId=${item.projectId}` : ""}`;
            return (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/learn/concepts/${item.conceptId}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {item.conceptName}
                    </Link>
                    {item.priority !== "NORMAL" && (
                      <Badge variant={item.priority === "HIGH" ? "default" : "secondary"}>
                        {t.priority[item.priority]}
                      </Badge>
                    )}
                    {item.pinned && <Badge variant="outline">{t.pinned}</Badge>}
                  </div>
                  {showProject && (
                    <p className="text-muted-foreground text-xs">
                      {item.projectName ? t.fromProject(item.projectName) : t.noProject}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    disabled={busy === item.id}
                    aria-pressed={item.pinned}
                    aria-label={item.pinned ? t.unpin(item.conceptName) : t.pin(item.conceptName)}
                    onClick={() => patch(item, { pinned: !item.pinned })}
                  >
                    {item.pinned ? <PinOff aria-hidden /> : <Pin aria-hidden />}
                  </Button>
                  <Button asChild variant="outline" size="sm">
                    <Link href={applyHref} aria-label={t.startApplyLabel(item.conceptName)}>
                      <Target aria-hidden />
                      {t.startApply}
                    </Link>
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy === item.id}
                    aria-label={t.resolveLabel(item.conceptName)}
                    onClick={() => patch(item, { status: "RESOLVED" })}
                  >
                    <CheckCircle2 aria-hidden />
                    {t.resolve}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
