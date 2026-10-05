"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import type { TodayCardType } from "@/domain/today/select-actions";
import { cn } from "@/lib/utils";
import { trackCardClick } from "./track";

const TONE: Record<TodayCardType | "NEUTRAL", string> = {
  RESUME: "",
  NEEDS_REVIEW: "",
  APPLY: "bg-apply text-white hover:bg-apply/90 dark:text-black",
  BUILD: "bg-build text-black hover:bg-build/90",
  NEUTRAL: "",
};

/**
 * The primary action of a Today card. Reports the click (fire-and-forget) and then lets the link
 * navigate as usual, so a slow or failing request never blocks the student.
 */
export function CardLink({
  href,
  cardType,
  tone = cardType,
  label,
  children,
  className,
}: {
  href: string;
  cardType: TodayCardType;
  /** Colors the button; RESUME picks Apply or Build to match the session. */
  tone?: TodayCardType | "NEUTRAL";
  /** The accessible name when the visible text alone would be ambiguous. */
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Button asChild size="lg" className={cn("h-10 px-4 sm:h-9", TONE[tone], className)}>
      <Link href={href} aria-label={label} onClick={() => trackCardClick(cardType)}>
        {children}
      </Link>
    </Button>
  );
}
