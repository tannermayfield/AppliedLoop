"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { APPLY_COPY } from "@/lib/copy-sessions";

const t = APPLY_COPY.session;

interface Props {
  sessionId: string;
  title: string;
  task: string;
  rationale: string;
  successCriteria: string[];
  /** Read-only sessions show the criteria without checkboxes. */
  interactive: boolean;
}

/** The practice challenge. Checklist ticks live only in this browser (localStorage). */
export function ChallengeCard({
  sessionId,
  title,
  task,
  rationale,
  successCriteria,
  interactive,
}: Props) {
  const key = `appliedloop:apply-criteria:${sessionId}`;
  const [ticked, setTicked] = useState<number[]>([]);
  // Below `lg` the card sits above the conversation, so the long part starts folded (audit F-25).
  // Plain CSS does the responsive part, so server and client render the same markup.
  const [expanded, setExpanded] = useState(false);
  const hasDetails = Boolean(rationale) || successCriteria.length > 0;

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(key) ?? "[]");
      // eslint-disable-next-line react-hooks/set-state-in-effect -- hydrate from storage once on mount
      if (Array.isArray(stored)) setTicked(stored.filter((n) => Number.isInteger(n)));
    } catch {
      // Storage unavailable: ticks just won't persist.
    }
  }, [key]);

  function toggle(index: number, checked: boolean) {
    const next = checked ? [...new Set([...ticked, index])] : ticked.filter((n) => n !== index);
    setTicked(next);
    try {
      window.localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // ignore
    }
  }

  return (
    <section
      aria-labelledby="challenge-title"
      className="bg-card space-y-4 rounded-2xl border p-4 sm:p-5"
    >
      <div className="space-y-1">
        <p className="text-apply-ink text-xs font-semibold tracking-wide uppercase">
          {t.challenge}
        </p>
        <h2 id="challenge-title" className="font-display text-lg font-semibold text-balance">
          {title}
        </h2>
        <p className="text-sm text-pretty">{task}</p>
      </div>
      {hasDetails && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls="challenge-details"
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring/50 -mx-1 flex items-center gap-1 rounded-sm px-1 text-sm underline-offset-4 outline-none hover:underline focus-visible:ring-3 lg:hidden"
        >
          <ChevronDown
            className={cn("size-4 transition-transform", expanded && "rotate-180")}
            aria-hidden
          />
          {expanded ? t.hideChallengeDetails : t.showChallengeDetails}
        </button>
      )}
      <div id="challenge-details" className={cn("space-y-4", !expanded && "max-lg:hidden")}>
        {rationale && (
          <div className="space-y-1">
            <h3 className="text-muted-foreground text-xs font-semibold uppercase">{t.whyFits}</h3>
            <p className="text-muted-foreground text-sm text-pretty">{rationale}</p>
          </div>
        )}
        {successCriteria.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-muted-foreground text-xs font-semibold uppercase">
              {t.successCriteria}
            </h3>
            <ul className="space-y-2">
              {successCriteria.map((criterion, index) => (
                <li key={index} className="flex items-start gap-2.5 text-sm">
                  {interactive ? (
                    <>
                      <Checkbox
                        id={`criterion-${index}`}
                        className="mt-0.5"
                        checked={ticked.includes(index)}
                        onCheckedChange={(value) => toggle(index, value === true)}
                      />
                      <label htmlFor={`criterion-${index}`} className="cursor-pointer text-pretty">
                        {criterion}
                      </label>
                    </>
                  ) : (
                    <span className="text-pretty">• {criterion}</span>
                  )}
                </li>
              ))}
            </ul>
            {interactive && <p className="text-muted-foreground text-xs">{t.criteriaNote}</p>}
          </div>
        )}
      </div>
    </section>
  );
}
