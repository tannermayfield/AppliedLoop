import type { TodayView } from "@/domain/today/today";
import { todayCopy } from "@/lib/copy-today";

export type NextStepKind = "setup" | "add-project" | "no-active-project" | "capture";

export interface NextStep {
  kind: NextStepKind;
  title: string;
  description: string;
  action: string;
  href: string;
}

/**
 * The one thing Today suggests when the cards alone don't cover the student's situation: finish
 * setup, add a project, reopen a project, or capture something they learned. Null when the cards
 * already include an Apply suggestion.
 */
export function nextStepFor(view: TodayView): NextStep | null {
  const empty = todayCopy.empty;
  if (!view.hasProject && !view.hasSource)
    return { kind: "setup", ...empty.setup, href: "/onboarding" };
  if (!view.hasProject) return { kind: "add-project", ...empty.addProject, href: "/projects/new" };
  if (view.cards.length === 0) {
    return { kind: "no-active-project", ...empty.noActiveProject, href: "/projects" };
  }
  if (!view.cards.some((card) => card.type === "APPLY")) {
    return { kind: "capture", ...empty.capture, href: "/learn" };
  }
  return null;
}
