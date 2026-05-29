const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
});

const TIME_FMT = new Intl.DateTimeFormat("en-US", {
  hour: "numeric",
  minute: "2-digit",
});

/** "Fri, Jun 12" — date only. */
export function formatDate(ms: number): string {
  return DATE_FMT.format(new Date(ms));
}

/** "Fri, Jun 12 · 8:00 PM" — date + time, or date alone when dateOnly. */
export function formatDateTime(ms: number, dateOnly: boolean): string {
  const date = formatDate(ms);
  return dateOnly ? date : `${date} · ${TIME_FMT.format(new Date(ms))}`;
}

/** "8:42 PM" — clock time, for recent-play timestamps. */
export function formatClock(ms: number): string {
  return TIME_FMT.format(new Date(ms));
}

const USD_FMT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

/** "$12,500" — whole-dollar USD, for fundraiser goal/raised amounts. */
export function formatUsd(amount: number): string {
  return USD_FMT.format(Math.max(0, Math.round(amount)));
}
