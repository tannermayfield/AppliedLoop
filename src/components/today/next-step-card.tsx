import Link from "next/link";
import { BookOpen, Compass, FolderPlus, Sprout } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import type { NextStep, NextStepKind } from "./next-step";

const ICONS: Record<NextStepKind, typeof Compass> = {
  setup: Sprout,
  "add-project": FolderPlus,
  "no-active-project": Compass,
  capture: BookOpen,
};

/** The single next step for a situation the cards don't cover. Full empty state, or a slim nudge. */
export function NextStepCard({ step, variant }: { step: NextStep; variant: "empty" | "nudge" }) {
  if (variant === "empty") {
    return (
      <EmptyState
        icon={ICONS[step.kind]}
        title={step.title}
        description={step.description}
        action={
          <Button asChild className="h-10 px-4 sm:h-9">
            <Link href={step.href}>{step.action}</Link>
          </Button>
        }
      />
    );
  }

  return (
    <section
      aria-labelledby="today-next-step"
      className="flex flex-col gap-3 rounded-2xl border border-dashed p-5 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="space-y-1">
        <h2 id="today-next-step" className="text-base font-medium">
          {step.title}
        </h2>
        <p className="text-muted-foreground max-w-xl text-sm text-pretty">{step.description}</p>
      </div>
      <Button asChild variant="outline" className="h-10 shrink-0 px-4 sm:h-9">
        <Link href={step.href}>{step.action}</Link>
      </Button>
    </section>
  );
}
