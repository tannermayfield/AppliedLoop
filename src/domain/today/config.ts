import type { TodayCardType } from "./select-actions";

// The knobs behind Today (SPEC_REVIEW R-09 / D-3). One place, so a rule change is a one-line edit
// and the tests can pass their own values.

/** A concept counts as "recent" for the APPLY card for this many days after it was captured or moved. */
export const RECENT_DAYS = 14;

/** At most this many cards of each type. */
export const MAX_CARDS_PER_TYPE = 1;

/** The order cards appear in. An in-progress session always comes first (AT-06). */
export const CARD_ORDER: readonly TodayCardType[] = ["RESUME", "NEEDS_REVIEW", "APPLY", "BUILD"];

/** How many concept names the Needs Review strip spells out. */
export const STRIP_TOP_COUNT = 3;

export interface TodayConfig {
  recentDays: number;
  maxCardsPerType: number;
  order: readonly TodayCardType[];
  stripTopCount: number;
}

export const TODAY_CONFIG: TodayConfig = {
  recentDays: RECENT_DAYS,
  maxCardsPerType: MAX_CARDS_PER_TYPE,
  order: CARD_ORDER,
  stripTopCount: STRIP_TOP_COUNT,
};
