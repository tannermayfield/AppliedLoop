import Link from "next/link";
import { ArrowRight, BookmarkCheck } from "lucide-react";
import { ModeBadge } from "@/components/mode-badge";
import { StageBadge } from "@/components/stage-badge";
import type { TodayCard } from "@/domain/today/select-actions";
import { todayCopy } from "@/lib/copy-today";
import { cn } from "@/lib/utils";
import { CardLink } from "./card-link";

const copy = todayCopy.cards;

/** One suggested next step. Apply is teal, Build is amber, Needs Review is calm and neutral. */
export function TodayCardView({ card }: { card: TodayCard }) {
  switch (card.type) {
    case "RESUME": {
      const title = card.title.trim() || copy.resume.untitled;
      return (
        <Frame mode={card.sessionType} headingId={`today-${card.sessionId}`}>
          <div className="space-y-1">
            <p className="text-muted-foreground text-sm font-medium">{copy.resume.eyebrow}</p>
            <ModeBadge mode={card.sessionType} />
          </div>
          <div className="space-y-1">
            <h2
              id={`today-${card.sessionId}`}
              className="font-display text-xl font-semibold text-balance"
            >
              {title}
            </h2>
            <p className="text-muted-foreground text-sm">
              {copy.resume.inProject(card.projectName)}
            </p>
          </div>
          <CardLink
            href={card.href}
            cardType="RESUME"
            tone={card.sessionType}
            label={copy.resume.actionLabel(title)}
          >
            {copy.resume.action}
            <ArrowRight aria-hidden />
          </CardLink>
        </Frame>
      );
    }

    case "NEEDS_REVIEW":
      return (
        <Frame headingId={`today-${card.debtId}`}>
          <p className="text-muted-foreground inline-flex items-center gap-1.5 text-sm font-medium">
            <BookmarkCheck className="size-4" aria-hidden />
            {copy.needsReview.eyebrow}
          </p>
          <div className="space-y-1">
            <h2
              id={`today-${card.debtId}`}
              className="font-display text-xl font-semibold text-balance"
            >
              {card.conceptName}
            </h2>
            <p className="text-muted-foreground text-sm text-pretty">{copy.needsReview.body}</p>
          </div>
          <CardLink
            href={card.href}
            cardType="NEEDS_REVIEW"
            tone="NEUTRAL"
            label={copy.needsReview.actionLabel(
              card.projectId ? copy.needsReview.practice : copy.needsReview.open,
              card.conceptName,
            )}
          >
            {card.projectId ? copy.needsReview.practice : copy.needsReview.open}
            <ArrowRight aria-hidden />
          </CardLink>
        </Frame>
      );

    case "APPLY":
      return (
        <Frame mode="APPLY" headingId={`today-apply-${card.conceptId}`}>
          <ModeBadge mode="APPLY" />
          <div className="space-y-1.5">
            <h2
              id={`today-apply-${card.conceptId}`}
              className="font-display text-xl font-semibold text-balance"
            >
              {card.conceptName}
            </h2>
            <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <StageBadge stage={card.stage} />
              {card.sourceTitle && <span>{copy.apply.from(card.sourceTitle)}</span>}
            </p>
            <p className="text-sm">{copy.apply.practiceIn(card.projectName)}</p>
          </div>
          <CardLink
            href={card.href}
            cardType="APPLY"
            label={copy.apply.actionLabel(card.conceptName)}
          >
            {copy.apply.action}
            <ArrowRight aria-hidden />
          </CardLink>
        </Frame>
      );

    case "BUILD":
      return (
        <Frame mode="BUILD" headingId={`today-build-${card.projectId}`}>
          <ModeBadge mode="BUILD" />
          <div className="space-y-1.5">
            <h2
              id={`today-build-${card.projectId}`}
              className="font-display text-xl font-semibold text-balance"
            >
              {card.projectName}
            </h2>
            {card.milestone ? (
              <p className="text-sm">{copy.build.milestone(card.milestone)}</p>
            ) : (
              <p className="text-sm">
                <Link
                  href={`/projects/${card.projectId}`}
                  aria-label={copy.build.setMilestoneLabel(card.projectName)}
                  className="underline underline-offset-4"
                >
                  {copy.build.setMilestone}
                </Link>
              </p>
            )}
          </div>
          <CardLink
            href={card.href}
            cardType="BUILD"
            label={copy.build.actionLabel(card.projectName)}
          >
            {copy.build.action}
            <ArrowRight aria-hidden />
          </CardLink>
        </Frame>
      );
  }
}

function Frame({
  mode,
  headingId,
  children,
}: {
  mode?: "APPLY" | "BUILD";
  headingId: string;
  children: React.ReactNode;
}) {
  return (
    <article
      aria-labelledby={headingId}
      data-mode={mode}
      className={cn(
        "flex flex-col items-start gap-4 rounded-2xl border p-5 sm:p-6",
        mode === "APPLY" && "border-apply/30 bg-apply-soft",
        mode === "BUILD" && "border-build/40 bg-build-soft",
        !mode && "bg-card",
      )}
    >
      {children}
    </article>
  );
}
