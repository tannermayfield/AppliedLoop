"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Check, ChevronDown, Circle, Copy } from "lucide-react";
import { api } from "@/components/sessions/api";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { ContextPackEntry } from "@/domain/sessions/build/context-pack";
import { BUILD_COPY } from "@/lib/copy-build";

const t = BUILD_COPY.session;

type Target = "CODEX" | "CLAUDE_CODE";
const TARGET_NAMES: Record<Target, string> = { CODEX: "Codex", CLAUDE_CODE: "Claude Code" };

/** What the pack contains (honest about gaps), a preview, and the two copy buttons. */
export function ContextPackCard({
  sessionId,
  projectId,
  included,
  briefVersion,
  packs,
}: {
  sessionId: string;
  projectId: string;
  included: ContextPackEntry[];
  /** Which wording of the agent brief the packs carry (recorded with the copy event). */
  briefVersion: string;
  packs: Record<Target, string>;
}) {
  const [status, setStatus] = useState<string | null>(null);
  const [fallback, setFallback] = useState<string | null>(null);
  const fallbackRef = useRef<HTMLTextAreaElement>(null);
  const missing = included.filter((entry) => !entry.present);

  async function copy(target: Target) {
    const text = packs[target];
    try {
      await navigator.clipboard.writeText(text);
      setFallback(null);
      setStatus(t.copied(TARGET_NAMES[target]));
    } catch {
      // Clipboard blocked (permissions, insecure context): show the text selected for Ctrl+C.
      setFallback(text);
      setStatus(t.copyFallback);
      requestAnimationFrame(() => fallbackRef.current?.select());
    }
    // Client-originated telemetry (SPEC_REVIEW R-20). Never blocks the student.
    void api("/api/v1/events", {
      body: {
        name: "context_pack_copied",
        entityType: "session",
        entityId: sessionId,
        metadata: { target, brief: briefVersion },
      },
    });
  }

  return (
    <section
      aria-labelledby="pack-heading"
      className="bg-card border-build/40 space-y-4 rounded-2xl border p-4 sm:p-5"
    >
      <div>
        <h2 id="pack-heading" className="font-display text-lg font-semibold">
          {t.packHeading}
        </h2>
        <p className="text-muted-foreground text-sm">{t.packHint}</p>
      </div>
      <ul className="grid gap-1.5 sm:grid-cols-2">
        {included.map((entry) => (
          <li key={entry.key} className="flex items-center gap-2 text-sm">
            {entry.present ? (
              <Check className="text-build-ink size-4 shrink-0" aria-hidden />
            ) : (
              <Circle className="text-muted-foreground size-4 shrink-0" aria-hidden />
            )}
            <span className={entry.present ? "" : "text-muted-foreground"}>
              {entry.label}
              {!entry.present && <span className="sr-only">: {t.packMissing}</span>}
              {!entry.present && (
                <span aria-hidden className="text-xs">
                  {" "}
                  · {t.packMissing}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      {missing.length > 0 && (
        <Link
          href={`/projects/${projectId}?tab=overview`}
          className="text-sm font-medium underline underline-offset-4"
        >
          {t.packEditContext}
        </Link>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={() => copy("CODEX")}>
          <Copy aria-hidden />
          {t.copyCodex}
        </Button>
        <Button type="button" variant="outline" onClick={() => copy("CLAUDE_CODE")}>
          <Copy aria-hidden />
          {t.copyClaude}
        </Button>
      </div>
      <p role="status" aria-live="polite" className="text-sm">
        {status}
      </p>
      {fallback && (
        <textarea
          ref={fallbackRef}
          readOnly
          value={fallback}
          aria-label={t.packPreview}
          className="border-input h-48 w-full rounded-lg border bg-transparent p-2 font-mono text-xs"
        />
      )}
      <Collapsible>
        <CollapsibleTrigger className="group text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 inline-flex items-center gap-1 rounded text-sm font-medium outline-none focus-visible:ring-3">
          <ChevronDown
            className="size-4 transition-transform group-data-[state=open]:rotate-180 motion-reduce:transition-none"
            aria-hidden
          />
          {t.packPreview}
        </CollapsibleTrigger>
        <CollapsibleContent>
          <pre className="bg-muted mt-2 max-h-96 overflow-auto rounded-lg p-3 text-xs whitespace-pre-wrap">
            {packs.CODEX}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </section>
  );
}
