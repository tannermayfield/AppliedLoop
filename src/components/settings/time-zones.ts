/**
 * Every IANA time zone this runtime knows, with UTC (the default) first and the student's current
 * value always present, so the picker never shows a blank for a zone the list happens to omit.
 * Built on the server and passed down as a prop, so the browser renders the same list.
 */
export function listTimeZones(current: string): string[] {
  const known =
    typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  const rest = [...new Set([...known, current])].filter((zone) => zone !== "UTC").sort();
  return ["UTC", ...rest];
}
