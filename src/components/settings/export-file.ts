import { settingsCopy } from "@/lib/copy-settings";

/**
 * The file name the server chose in `Content-Disposition: attachment; filename="…"`, or a safe
 * default. Anything that could be a path (a slash, a backslash) or a quote is refused, so a
 * download can never be steered outside the browser's downloads folder.
 */
export function filenameFromDisposition(header: string | null): string {
  const match = header?.match(/filename="([^"\\/]+)"/);
  return match?.[1] ?? settingsCopy.data.fileFallback;
}
