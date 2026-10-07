// Time zones: the pure rules, shared by the server (domain/identity/me.ts) and the browser
// (components/shell/time-zone-sync.tsx) so both sides agree on when the browser's zone may be
// adopted. No framework imports, so a unit test can pin the whole rule.

/** What every new profile starts with (`user_profiles.timezone`). */
export const DEFAULT_TIME_ZONE = "UTC";

/** `Area/Location` names ("America/Denver", "America/Argentina/Buenos_Aires") and single tokens ("UTC"). */
const IANA_SHAPE = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+)*$/;

/** Names that mean "no offset": adopting one of them would change nothing for the student. */
const UTC_NAMES = new Set([
  "UTC",
  "UCT",
  "GMT",
  "GMT0",
  "Zulu",
  "Universal",
  "Greenwich",
  "Etc/UTC",
  "Etc/UCT",
  "Etc/GMT",
  "Etc/GMT0",
  "Etc/GMT+0",
  "Etc/GMT-0",
  "Etc/Zulu",
  "Etc/Universal",
  "Etc/Greenwich",
]);

export function isValidTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * The runtime's canonical spelling of an IANA time zone ("america/denver" becomes
 * "America/Denver"), or null when the value is not a time zone name this runtime knows. Offsets
 * such as "+05:30" are not IANA names and give null.
 */
export function canonicalTimeZone(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim();
  if (name.length === 0 || name.length > 100 || !IANA_SHAPE.test(name)) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: name }).resolvedOptions().timeZone;
  } catch {
    return null;
  }
}

/** True for UTC and its aliases ("Etc/UTC", "GMT", ...). */
export function isUtcLike(zone: string): boolean {
  return UTC_NAMES.has(zone);
}

/**
 * The browser's own time zone (an IANA name), or null when it cannot be read. Browser-side:
 * `Intl` in the browser reflects the device setting, which is the whole point.
 */
export function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/**
 * THE RULE for adopting the browser's time zone as the student's own. Returns the zone to store, or
 * null when nothing should change.
 *
 * The browser's zone is only a first guess for a profile that was never set. It may be adopted only
 * while BOTH hold:
 *   - the student never saved a time zone themselves (`timezoneChosen` is false), and
 *   - the profile still has the default (UTC).
 * A zone the student chose is never overwritten, nor is any non-default zone, nor is one adopted
 * earlier (it is no longer the default). A detected zone that is UTC or an alias of it, or that is
 * not a recognizable time zone, changes nothing.
 */
export function detectedTimeZoneToAdopt(
  profile: { timezone: string; timezoneChosen: boolean },
  detected: unknown,
): string | null {
  if (profile.timezoneChosen) return null;
  if (profile.timezone !== DEFAULT_TIME_ZONE) return null;
  const zone = canonicalTimeZone(detected);
  if (zone === null || isUtcLike(zone)) return null;
  return zone;
}
