import type { ProgressEventDto } from "@/domain/learning/progress";
import { PROGRESS_SOURCE_LABELS, STAGE_LABELS, learnCopy } from "@/lib/copy-learning";
import type { ConceptStage } from "@/lib/db/schema/enums";
import { formatDateTime } from "./format";

interface Props {
  /** Where the story starts: when the concept was added, and the stage it began at. */
  addedAt: Date;
  initialStage: ConceptStage;
  /** Stage changes, oldest first. */
  history: ProgressEventDto[];
  timeZone: string;
}

const copy = learnCopy.concept;

/** A concept's stage history, oldest first: how it got from where it began to where it is now. */
export function StageTimeline({ addedAt, initialStage, history, timeZone }: Props) {
  return (
    <ol className="border-border relative ml-1.5 space-y-5 border-l pl-5">
      <li className="relative">
        <span
          aria-hidden
          className="bg-muted-foreground absolute top-1.5 -left-[1.6rem] size-2 rounded-full"
        />
        <p className="text-sm font-medium">{copy.addedAs(STAGE_LABELS[initialStage])}</p>
        <p className="text-muted-foreground text-sm">
          <time dateTime={addedAt.toISOString()}>{formatDateTime(addedAt, { timeZone })}</time>
        </p>
      </li>

      {history.map((event) => (
        <li key={event.id} className="relative">
          <span
            aria-hidden
            className="bg-apply absolute top-1.5 -left-[1.6rem] size-2 rounded-full"
          />
          <p className="text-sm font-medium">
            {event.fromStage
              ? copy.movedFromTo(STAGE_LABELS[event.fromStage], STAGE_LABELS[event.toStage])
              : copy.movedTo(STAGE_LABELS[event.toStage])}
          </p>
          <p className="text-muted-foreground text-sm">
            <time dateTime={event.createdAt.toISOString()}>
              {formatDateTime(event.createdAt, { timeZone })}
            </time>
            {" · "}
            {PROGRESS_SOURCE_LABELS[event.source]}
          </p>
          {event.reason && (
            <p className="text-muted-foreground mt-0.5 text-sm text-pretty">
              {copy.withReason(event.reason)}
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
