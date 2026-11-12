/**
 * Date and number formatting for the UI.
 *
 * Rules from docs/design-system.md: missing data reads "Not available" and never a guess,
 * and counts are written plainly. Everything takes the clock as an argument so the tests are
 * deterministic instead of depending on the machine's time zone or today's date.
 */

/** The wording for a value the API does not have, used everywhere so the app reads the same. */
export const NOT_AVAILABLE = 'Not available';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** "just now", "3 minutes ago", "2 days ago". */
export function formatRelativeTime(
  iso: string | null | undefined,
  now: number = Date.now(),
): string {
  if (!iso) return NOT_AVAILABLE;
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return NOT_AVAILABLE;

  const diff = Math.max(0, now - then);
  if (diff < MINUTE) return 'just now';
  if (diff < HOUR)
    return `${Math.floor(diff / MINUTE)} ${plural(Math.floor(diff / MINUTE), 'minute')} ago`;
  if (diff < DAY)
    return `${Math.floor(diff / HOUR)} ${plural(Math.floor(diff / HOUR), 'hour')} ago`;

  const days = Math.floor(diff / DAY);
  if (days < 30) return `${days} ${plural(days, 'day')} ago`;
  return formatDate(iso);
}

/** "12 Nov 2026, 14:05" in the browser's locale and time zone. */
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return NOT_AVAILABLE;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return NOT_AVAILABLE;
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    date,
  );
}

/** A version the API may not have, without inventing one. */
export function formatVersion(version: string | null | undefined): string {
  return version && version.trim() !== '' ? version : NOT_AVAILABLE;
}

/** A version range such as "1.2.3 -> 1.3.0", or "Not available" when either side is missing. */
export function formatVersionChange(
  from: string | null | undefined,
  to: string | null | undefined,
): string {
  if (!from || !to) return NOT_AVAILABLE;
  return `${from} → ${to}`;
}

/** 1 application, 2 applications. */
export function plural(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many;
}

/** "1 application", "18 applications". Used in headings and status lines. */
export function countOf(count: number, one: string, many = `${one}s`): string {
  return `${count} ${plural(count, one, many)}`;
}
