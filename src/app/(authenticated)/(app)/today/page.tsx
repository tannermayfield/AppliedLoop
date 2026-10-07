import type { Metadata } from "next";
import { NeedsReviewStrip } from "@/components/today/needs-review-strip";
import { nextStepFor } from "@/components/today/next-step";
import { NextStepCard } from "@/components/today/next-step-card";
import { TodayCardView } from "@/components/today/today-card";
import { PageHeader } from "@/components/page-header";
import { getToday, partOfDay } from "@/domain/today/today";
import { getPageContext } from "@/lib/app-context";
import { todayCopy } from "@/lib/copy-today";

export const metadata: Metadata = { title: todayCopy.title };

export default async function TodayPage() {
  const c = await getPageContext();
  const view = await getToday(c);

  // The greeting is computed here, on the server, in the student's time zone, so the first paint
  // and the hydrated page always agree.
  const greeting = todayCopy.greeting(partOfDay(c.now(), view.timezone), view.greetingName);
  const step = nextStepFor(view);
  const hasCards = view.cards.length > 0;

  return (
    <>
      <PageHeader title={greeting} description={todayCopy.question} />

      <div className="space-y-6">
        {hasCards && (
          <ul aria-label={todayCopy.listLabel} className="grid gap-4">
            {view.cards.map((card) => (
              <li key={`${card.type}:${card.href}`}>
                <TodayCardView card={card} />
              </li>
            ))}
          </ul>
        )}

        {step && <NextStepCard step={step} variant={hasCards ? "nudge" : "empty"} />}

        <NeedsReviewStrip summary={view.needsReview} />
      </div>
    </>
  );
}
