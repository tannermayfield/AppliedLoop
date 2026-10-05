// Date wording for the Learn and Projects pages. Dates are formatted on the SERVER in the student's
// own time zone (their profile's) and passed to client components as text, so the server and the
// browser can never disagree about what a date says (a hydration mismatch).

interface FormatOptions {
  /** IANA time zone, e.g. "America/Denver". Unknown names fall back to UTC. */
  timeZone?: string;
  /** For tests: what "today" is. The year is only shown when it differs from this year's. */
  now?: Date;
}

function safeTimeZone(timeZone: string | undefined): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone ?? "UTC";
  } catch {
    return "UTC";
  }
}

/** Newer ICU versions put a narrow no-break space before "PM"; use plain spaces everywhere. */
const plainSpaces = (text: string) => text.replace(/[  ]/g, " ");

function yearIn(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { year: "numeric", timeZone }).format(date);
}

/** "Oct 6", or "Dec 31, 2025" when the year is not the current one. */
export function formatDate(value: Date | string, options: FormatOptions = {}): string {
  const date = new Date(value);
  const timeZone = safeTimeZone(options.timeZone);
  const sameYear = yearIn(date, timeZone) === yearIn(options.now ?? new Date(), timeZone);
  return plainSpaces(
    new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      ...(sameYear ? {} : { year: "numeric" }),
      timeZone,
    }).format(date),
  );
}

/** "Oct 6, 3:05 PM". */
export function formatDateTime(value: Date | string, options: FormatOptions = {}): string {
  const date = new Date(value);
  const timeZone = safeTimeZone(options.timeZone);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(date);
  return plainSpaces(`${formatDate(date, options)}, ${time}`);
}
