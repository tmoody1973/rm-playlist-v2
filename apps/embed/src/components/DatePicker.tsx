import { useEffect, useRef, useState } from "preact/hooks";

/**
 * Minimal single-month calendar picker for the playlist widget.
 *
 * Replaces native `<input type="date">` because that primitive renders
 * inconsistently across browsers (especially Safari + mobile WebViews).
 * Custom widget = predictable UX everywhere + brandable via DESIGN.md
 * tokens. Bundle cost ~1.5 KB gzip.
 *
 * Value is `YYYY-MM-DD` (matches the native input contract so callers can
 * swap one for the other).
 */

interface DatePickerProps {
  readonly value: string;
  readonly onChange: (next: string) => void;
  readonly ariaLabel: string;
  readonly placeholder?: string;
}

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const MONTH_LABELS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseISO(s: string): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function formatDisplay(s: string): string {
  const d = parseISO(s);
  if (!d) return "";
  const monthName = MONTH_LABELS[d.getMonth()] ?? "";
  return `${monthName.slice(0, 3)} ${d.getDate()}, ${d.getFullYear()}`;
}

export function DatePicker({ value, onChange, ariaLabel, placeholder }: DatePickerProps) {
  const [open, setOpen] = useState(false);
  const [viewMonth, setViewMonth] = useState<Date>(parseISO(value) ?? new Date());
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      // Shadow DOM-aware containment check. Without composedPath(), events
      // originating inside the shadow get retargeted to the shadow host at
      // document level — and `rootRef.contains(host)` is always false
      // because rootRef lives INSIDE the host. Result: every click inside
      // the popover would close it before the day button's handler fires.
      const path = e.composedPath();
      if (rootRef.current && !path.includes(rootRef.current)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = parseISO(value);
  const today = new Date();
  const todayISO = toISO(today);
  const firstOfMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), 1);
  const lead = firstOfMonth.getDay();
  const daysInMonth = new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 0).getDate();

  const cells: { iso: string; day: number; muted: boolean }[] = [];
  for (let i = 0; i < lead; i++) {
    const prevDate = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), -lead + i + 1);
    cells.push({ iso: toISO(prevDate), day: prevDate.getDate(), muted: true });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(viewMonth.getFullYear(), viewMonth.getMonth(), d);
    cells.push({ iso: toISO(date), day: d, muted: false });
  }
  while (cells.length % 7 !== 0) {
    const next = new Date(
      viewMonth.getFullYear(),
      viewMonth.getMonth() + 1,
      cells.length - lead - daysInMonth + 1,
    );
    cells.push({ iso: toISO(next), day: next.getDate(), muted: true });
  }

  const triggerStyle = {
    fontSize: "13px",
    fontFamily: "var(--rmke-font-body)",
    padding: "var(--rmke-space-sm) var(--rmke-space-md)",
    background: "var(--rmke-bg-base)",
    border: "1px solid var(--rmke-border)",
    borderRadius: "var(--rmke-radius-sm)",
    color: value ? "var(--rmke-text-primary)" : "var(--rmke-text-muted)",
    cursor: "pointer",
    width: "100%",
    textAlign: "left" as const,
  };

  return (
    <div ref={rootRef} style={{ position: "relative", flex: 1 }}>
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={triggerStyle}
      >
        {value ? formatDisplay(value) : (placeholder ?? "Pick a date")}
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Choose a date"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            left: 0,
            zIndex: 10,
            background: "var(--rmke-bg-surface)",
            border: "1px solid var(--rmke-border)",
            borderRadius: "var(--rmke-radius-md)",
            padding: "var(--rmke-space-sm)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.18)",
            minWidth: "240px",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "var(--rmke-space-sm)",
            }}
          >
            <button
              type="button"
              aria-label="Previous month"
              onClick={() =>
                setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() - 1, 1))
              }
              style={navButtonStyle}
            >
              ‹
            </button>
            <span
              style={{
                fontSize: "13px",
                fontFamily: "var(--rmke-font-display)",
                fontWeight: 600,
              }}
            >
              {MONTH_LABELS[viewMonth.getMonth()]} {viewMonth.getFullYear()}
            </span>
            <button
              type="button"
              aria-label="Next month"
              onClick={() =>
                setViewMonth(new Date(viewMonth.getFullYear(), viewMonth.getMonth() + 1, 1))
              }
              style={navButtonStyle}
            >
              ›
            </button>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: "2px",
              fontSize: "13px",
              fontFamily: "var(--rmke-font-mono)",
              color: "var(--rmke-text-muted)",
              textAlign: "center",
              marginBottom: "4px",
            }}
          >
            {DAY_LABELS.map((d, i) => (
              <span key={i}>{d}</span>
            ))}
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(7, 1fr)",
              gap: "2px",
            }}
          >
            {cells.map((cell, i) => {
              const isSelected = selected !== null && cell.iso === toISO(selected);
              const isToday = cell.iso === todayISO;
              return (
                <button
                  key={i}
                  type="button"
                  onClick={() => {
                    onChange(cell.iso);
                    setOpen(false);
                  }}
                  style={{
                    padding: "6px 0",
                    fontSize: "13px",
                    fontFamily: "var(--rmke-font-body)",
                    border:
                      isToday && !isSelected
                        ? "1px solid var(--rmke-border)"
                        : "1px solid transparent",
                    borderRadius: "var(--rmke-radius-sm)",
                    background: isSelected ? "var(--rmke-text-primary)" : "transparent",
                    color: isSelected
                      ? "var(--rmke-bg-surface)"
                      : cell.muted
                        ? "var(--rmke-text-muted)"
                        : "var(--rmke-text-primary)",
                    cursor: "pointer",
                    opacity: cell.muted ? 0.5 : 1,
                  }}
                  aria-label={cell.iso}
                  aria-current={isSelected ? "date" : undefined}
                >
                  {cell.day}
                </button>
              );
            })}
          </div>

          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              marginTop: "var(--rmke-space-sm)",
              paddingTop: "var(--rmke-space-sm)",
              borderTop: "1px solid var(--rmke-border)",
            }}
          >
            <button
              type="button"
              onClick={() => {
                onChange("");
                setOpen(false);
              }}
              style={footerButtonStyle}
            >
              Clear
            </button>
            <button
              type="button"
              onClick={() => {
                onChange(todayISO);
                setOpen(false);
              }}
              style={footerButtonStyle}
            >
              Today
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const navButtonStyle = {
  background: "transparent",
  border: "1px solid var(--rmke-border)",
  borderRadius: "var(--rmke-radius-sm)",
  padding: "2px 8px",
  fontSize: "14px",
  cursor: "pointer",
  color: "var(--rmke-text-primary)",
  fontFamily: "var(--rmke-font-body)",
};

const footerButtonStyle = {
  background: "transparent",
  border: "none",
  fontSize: "13px",
  fontFamily: "var(--rmke-font-mono)",
  textTransform: "uppercase" as const,
  letterSpacing: "0.06em",
  color: "var(--rmke-text-muted)",
  cursor: "pointer",
  padding: "4px 8px",
};
