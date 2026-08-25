/**
 * Presentational bits shared by the settings sections.
 *
 * Extracted from SettingsClient.tsx when the alert-recipients section was
 * added — a second file needed the same eyebrow/table/skeleton chrome, and
 * copying CSS objects between siblings is how two screens quietly drift
 * apart. Purely visual; no data access lives here.
 */

export const eyebrowStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "11px",
  fontWeight: 600,
  letterSpacing: "0.12em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};

export const tableHeaderStyle: React.CSSProperties = {
  fontFamily: "var(--font-mono)",
  fontSize: "11px",
  letterSpacing: "0.06em",
  textTransform: "uppercase",
  color: "var(--text-muted)",
};

export function Skeleton({ rows }: { rows: number }) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="h-12 animate-pulse rounded-md bg-bg-surface"
          style={{ opacity: 0.6 }}
          aria-hidden="true"
        />
      ))}
    </div>
  );
}
