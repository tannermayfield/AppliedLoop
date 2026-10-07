"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { apiRequest } from "@/components/learning/api-client";
import { browserTimeZone, detectedTimeZoneToAdopt } from "@/lib/time-zone";

/**
 * Tells the server which time zone this browser is in, once, so Today's greeting and every date
 * match where the student is (every profile starts on UTC). Renders nothing.
 *
 * It only ever fills in a profile nobody has set: the rule is `detectedTimeZoneToAdopt`, and the
 * server applies the same rule again (`PATCH /me/profile` with `detectedTimezone`), so a zone the
 * student chose in Settings is never replaced. It is best effort: if the request fails nothing is
 * shown, and the student can still pick a zone in Settings.
 */
export function TimeZoneSync({
  timezone,
  timezoneChosen,
}: {
  timezone: string;
  timezoneChosen: boolean;
}) {
  const router = useRouter();
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    const adopt = detectedTimeZoneToAdopt({ timezone, timezoneChosen }, browserTimeZone());
    if (adopt === null) return;
    sent.current = true;
    apiRequest("/api/v1/me/profile", { method: "PATCH", body: { detectedTimezone: adopt } })
      // Re-render the page we are on, so the greeting already uses the new zone.
      .then(() => router.refresh())
      .catch(() => undefined);
  }, [timezone, timezoneChosen, router]);

  return null;
}
