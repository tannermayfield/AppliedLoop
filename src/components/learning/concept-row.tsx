import Link from "next/link";
import { Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ConceptDto } from "@/domain/learning/concepts";
import { learnCopy } from "@/lib/copy-learning";
import { formatDate } from "./format";
import { StageMenu } from "./stage-menu";

interface Props {
  concept: ConceptDto;
  /** The student's time zone, for the "Added" date. */
  timeZone: string;
  /** Show the source's title (when the list is not already grouped by source). */
  showSource?: boolean;
}

/** One concept in a list: its name, a little context, the stage control and the Apply button. */
export function ConceptRow({ concept, timeZone, showSource = false }: Props) {
  const details = [
    learnCopy.row.addedOn(formatDate(concept.capturedAt, { timeZone })),
    ...(showSource && concept.sourceTitle ? [concept.sourceTitle] : []),
    ...concept.skills.map((skill) => skill.name),
  ];

  return (
    <li className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <div className="min-w-0 space-y-0.5">
        <Link
          href={`/learn/concepts/${concept.id}`}
          className="focus-visible:ring-ring/50 rounded-sm font-medium underline-offset-4 outline-none hover:underline focus-visible:ring-3"
        >
          {concept.name}
        </Link>
        <p className="text-muted-foreground text-sm text-pretty">{details.join(" · ")}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {/* Remounted when the stage changes on the server, so its local state never goes stale. */}
        <StageMenu
          key={`${concept.id}-${concept.stage}`}
          conceptId={concept.id}
          conceptName={concept.name}
          stage={concept.stage}
        />
        <Button asChild variant="outline" size="sm" className="self-start">
          <Link
            href={`/apply/new?conceptId=${concept.id}`}
            aria-label={learnCopy.row.applyLabel(concept.name)}
          >
            <Target aria-hidden />
            {learnCopy.row.apply}
          </Link>
        </Button>
      </div>
    </li>
  );
}
