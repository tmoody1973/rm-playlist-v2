/**
 * Formatting helpers shared across widget variants. Kept deliberately tiny —
 * the embed bundle budget is 30KB gzip (see vite.config.ts comment).
 */

const DAY_DATE_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  month: "short",
  day: "numeric",
});

const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
});
const DATE_FMT = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
});

/**
 * Relative-time label for the now-playing variants' "Playing since …" row.
 * Shows freshness (the widget's core UX differentiator over V1) rather than
 * an exact timestamp.
 */
export function formatPlayedAt(epochMs: number): string {
  const ageSec = Math.floor((Date.now() - epochMs) / 1000);
  if (ageSec < 10) return "just now";
  if (ageSec < 60) return `${ageSec}s ago`;
  const ageMin = Math.floor(ageSec / 60);
  if (ageMin < 60) return `${ageMin}m ago`;
  const ageHr = Math.floor(ageMin / 60);
  if (ageHr < 24) return `${ageHr}h ago`;
  return DATE_FMT.format(new Date(epochMs));
}

/**
 * Clock-time label for playlist list/grid items, matching V1's behavior of
 * showing `toLocaleTimeString(hour, minute)`. For plays older than today we
 * append the short date so older rows are still orientable.
 *
 * Examples: "3:42 PM", "12:05 AM", "3:42 PM · Apr 22".
 */
/** "Fri, Jul 11 · 8:00 PM" — or just "Fri, Jul 11" when dateOnly. */
export function formatEventDate(startsAtMs: number, dateOnly: boolean): string {
  const d = new Date(startsAtMs);
  const dateStr = DAY_DATE_FMT.format(d);
  if (dateOnly) return dateStr;
  return `${dateStr} · ${TIME_FMT.format(d)}`;
}

/** "8:00 PM" — used for doorsAt label in the event modal. */
export function formatEventTime(epochMs: number): string {
  return TIME_FMT.format(new Date(epochMs));
}

export function formatPlayedAtClock(epochMs: number): string {
  const when = new Date(epochMs);
  const time = TIME_FMT.format(when);
  const now = new Date();
  const sameDay =
    when.getFullYear() === now.getFullYear() &&
    when.getMonth() === now.getMonth() &&
    when.getDate() === now.getDate();
  return sameDay ? time : `${time} · ${DATE_FMT.format(when)}`;
}
