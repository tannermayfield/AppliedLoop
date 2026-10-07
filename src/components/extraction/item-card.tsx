"use client";

import { useId } from "react";
import { FileText } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import type { ExtractionItemDto } from "@/domain/extraction/items";
import { DISPOSITION_LABELS, UNDERSTANDING_LABELS } from "@/lib/copy";
import { EXTRACTION_COPY } from "@/lib/copy-extraction";
import {
  USER_UNDERSTANDINGS,
  type ExtractionDisposition,
  type UserUnderstanding,
} from "@/lib/db/schema/enums";
import { cn } from "@/lib/utils";

const t = EXTRACTION_COPY;
const CHOICES: Exclude<ExtractionDisposition, "UNREVIEWED">[] = [
  "NEEDS_REVIEW",
  "ALREADY_KNOW",
  "IGNORED",
];

/**
 * One potential concept. The self-assessment is optional and never decides anything; "Add to
 * Needs Review" is highlighted (never preselected) when the student says NOT_YET or SHAKY.
 */
export function ItemCard({
  item,
  busy,
  onUnderstanding,
  onDisposition,
}: {
  item: ExtractionItemDto;
  busy: boolean;
  onUnderstanding: (value: UserUnderstanding) => void;
  onDisposition: (value: ExtractionDisposition) => void;
}) {
  const id = useId();
  const highlight =
    item.disposition === "UNREVIEWED" &&
    (item.userUnderstanding === "NOT_YET" || item.userUnderstanding === "SHAKY");

  return (
    <article
      aria-labelledby={`${id}-name`}
      className="bg-card space-y-4 rounded-2xl border p-4 sm:p-5"
    >
      <header className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 id={`${id}-name`} className="font-display text-lg font-semibold">
            {item.name}
          </h3>
          <Badge variant="secondary">{item.category}</Badge>
          {item.existingConceptId && <Badge variant="outline">{t.inLibrary}</Badge>}
        </div>
        {item.reason && <p className="text-sm">{t.introducedBecause(item.reason)}</p>}
        {item.confidence !== null && (
          <p className="text-muted-foreground text-xs">{t.confidence(item.confidence)}</p>
        )}
      </header>

      <div className="space-y-1">
        <h4 className="text-muted-foreground text-xs font-medium tracking-wide uppercase">
          {t.evidence}
        </h4>
        <ul className="flex flex-wrap gap-1.5">
          {item.evidenceRefs.map((ref) => (
            <li
              key={ref}
              className="bg-muted inline-flex max-w-full items-center gap-1 rounded-md px-2 py-0.5 font-mono text-xs break-all"
            >
              <FileText className="size-3 shrink-0" aria-hidden />
              {ref}
            </li>
          ))}
        </ul>
      </div>

      {item.selfAssessmentQuestion && (
        <div className="bg-secondary/60 rounded-xl px-3 py-2 text-sm">
          <span className="text-muted-foreground block text-xs">{t.selfCheck}</span>
          {item.selfAssessmentQuestion}
        </div>
      )}

      <fieldset className="space-y-2" disabled={busy}>
        <legend className="text-sm font-medium">{t.howComfortable}</legend>
        <RadioGroup
          value={item.userUnderstanding ?? ""}
          onValueChange={(value) => onUnderstanding(value as UserUnderstanding)}
          // Side by side, wrapping on a phone: six candidates stack five radios each otherwise
          // (audit F-18d). Every option stays visible; nothing is folded away.
          className="flex flex-wrap gap-x-5 gap-y-2"
        >
          {USER_UNDERSTANDINGS.map((value) => (
            <div key={value} className="flex items-center gap-2">
              <RadioGroupItem value={value} id={`${id}-${value}`} />
              <Label htmlFor={`${id}-${value}`} className="text-sm font-normal">
                {UNDERSTANDING_LABELS[value]}
              </Label>
            </div>
          ))}
        </RadioGroup>
      </fieldset>

      <div className="space-y-2">
        <p id={`${id}-disposition`} className="text-sm font-medium">
          {t.disposition}
        </p>
        <div role="group" aria-labelledby={`${id}-disposition`} className="flex flex-wrap gap-2">
          {CHOICES.map((choice) => {
            const selected = item.disposition === choice;
            return (
              <Button
                key={choice}
                type="button"
                size="sm"
                disabled={busy}
                aria-pressed={selected}
                variant={selected ? "default" : "outline"}
                onClick={() => onDisposition(choice)}
                className={cn(
                  choice === "NEEDS_REVIEW" &&
                    highlight &&
                    !selected &&
                    "border-build bg-build-soft text-build-ink",
                )}
              >
                {DISPOSITION_LABELS[choice]}
              </Button>
            );
          })}
        </div>
        {highlight && <p className="text-muted-foreground text-xs">{t.suggestHighlight}</p>}
      </div>
    </article>
  );
}
