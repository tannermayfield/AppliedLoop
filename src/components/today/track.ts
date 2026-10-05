import type { TodayCardType } from "@/domain/today/select-actions";

/**
 * Tell the server a Today card was clicked (`today_card_clicked`). Fire-and-forget: it returns
 * immediately, `keepalive` lets it finish while the page navigates away, and a failure is ignored
 * because telemetry must never get in the student's way.
 */
export function trackCardClick(cardType: TodayCardType): void {
  try {
    void fetch("/api/v1/events", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "today_card_clicked", metadata: { card_type: cardType } }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // ignored on purpose
  }
}
