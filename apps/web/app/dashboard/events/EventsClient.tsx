"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@rm/convex/api";
import type { FunctionReturnType } from "convex/server";

type EventRow = FunctionReturnType<typeof api.events.allUpcomingEvents>[number];
type SourceFilter = "all" | "ticketmaster" | "axs" | "custom";
type RegionFilter = "all" | "Milwaukee" | "Madison" | "Chicago";

/**
 * Client component for the /dashboard/events browse page.
 *
 * Filter state is component-local. Six surfaces of polish over the v0
 * naive list:
 *   1. Sticky FilterBar so filters stay reachable while scrolling
 *   2. Group-by-date section headers ("Tuesday May 5") for calendar rhythm
 *   3. Artist filter — substring match on headliner+support names
 *   4. "Hide events with 0 rotation matches" toggle — server returns
 *      hasRotationMatch per row; toggle drops everything that's false
 *   5. CSV export of the currently-filtered events (operator's pitch tool)
 *   6. Click-row → drawer with full event details + all artists + status
 *
 * Search is debounced 200ms so typing doesn't fire a Convex re-query
 * per keystroke.
 */
export function EventsClient() {
  const [search, setSearch] = useState("");
  const [artistFilter, setArtistFilter] = useState("");
  const [region, setRegion] = useState<RegionFilter>("all");
  const [source, setSource] = useState<SourceFilter>("all");
  const [hideNoRotation, setHideNoRotation] = useState(false);
  const [selectedEvent, setSelectedEvent] = useState<EventRow | null>(null);

  const debouncedSearch = useDebounced(search, 200);
  const debouncedArtist = useDebounced(artistFilter, 150);

  const events = useQuery(api.events.allUpcomingEvents, {
    orgSlug: "radiomilwaukee",
    horizonDays: 90,
    // Pull the entire 90-day window. The earlier 200 cap was sorting
    // events by date asc and slicing — meaning artist filter (client-
    // side) couldn't see anyone playing past the first 200 dates.
    // Thundercat opening for The Strokes on Jun 17 sat past that
    // cutoff. 2000 covers RM's whole horizon (~850 events at 90d) with
    // headroom; under Convex's 16k-doc / 8MB query budget.
    limit: 2000,
    search: debouncedSearch.trim().length > 0 ? debouncedSearch : undefined,
    region: region === "all" ? undefined : region,
    source: source === "all" ? undefined : source,
  });

  // Client-side artist filter + rotation toggle. Server returned
  // headliners/supports already; re-filtering here is instant for the
  // ≤200 events visible.
  const filteredEvents = useMemo(() => {
    if (events === undefined) return undefined;
    const needle = debouncedArtist.trim().toLowerCase();
    return events.filter((e) => {
      if (hideNoRotation && !e.hasRotationMatch) return false;
      if (needle.length > 0) {
        const allArtists = [...e.headliners, ...e.supports].join(" ").toLowerCase();
        if (!allArtists.includes(needle)) return false;
      }
      return true;
    });
  }, [events, debouncedArtist, hideNoRotation]);

  const grouped = useMemo(() => {
    if (filteredEvents === undefined) return undefined;
    return groupByDate(filteredEvents);
  }, [filteredEvents]);

  const filtersActive =
    debouncedSearch.length > 0 ||
    debouncedArtist.length > 0 ||
    region !== "all" ||
    source !== "all" ||
    hideNoRotation;

  const onClearFilters = () => {
    setSearch("");
    setArtistFilter("");
    setRegion("all");
    setSource("all");
    setHideNoRotation(false);
  };

  const onExport = () => {
    if (filteredEvents === undefined || filteredEvents.length === 0) return;
    const csv = toCsv(filteredEvents);
    const today = new Date().toISOString().slice(0, 10);
    downloadCsv(csv, `rm-events-${today}.csv`);
  };

  return (
    <section className="flex flex-col gap-4">
      <div
        className="sticky z-10 -mx-6 flex flex-col gap-3 border-b border-border bg-bg-base px-6 pb-3 pt-2"
        style={{ top: "0" }}
      >
        <FilterBar
          search={search}
          onSearchChange={setSearch}
          artistFilter={artistFilter}
          onArtistFilterChange={setArtistFilter}
          region={region}
          onRegionChange={setRegion}
          source={source}
          onSourceChange={setSource}
        />
        <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-3">
            <RotationToggle value={hideNoRotation} onChange={setHideNoRotation} />
            <span className="text-text-muted" style={{ fontFamily: "var(--font-mono)" }}>
              {filteredEvents === undefined
                ? "Loading…"
                : `${filteredEvents.length} ${filteredEvents.length === 1 ? "event" : "events"}`}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {filtersActive && (
              <button
                type="button"
                onClick={onClearFilters}
                className="text-xs uppercase tracking-wider text-text-muted hover:text-accent-cta"
                style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}
              >
                Clear filters
              </button>
            )}
            <button
              type="button"
              onClick={onExport}
              disabled={filteredEvents === undefined || filteredEvents.length === 0}
              className="rounded-md border border-border bg-bg-elevated px-3 py-1 text-xs font-semibold uppercase text-text-primary transition-colors hover:border-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              style={{ letterSpacing: "0.04em", fontFamily: "var(--font-mono)" }}
            >
              Export CSV
            </button>
          </div>
        </div>
      </div>

      {filteredEvents === undefined ? (
        <EventsLoading />
      ) : filteredEvents.length === 0 ? (
        <EventsEmpty hasFilters={filtersActive} />
      ) : (
        <div className="flex flex-col gap-6">
          {grouped?.map((group) => (
            <DateGroup
              key={group.dateLabel}
              group={group}
              onSelect={(event) => setSelectedEvent(event)}
            />
          ))}
        </div>
      )}

      {selectedEvent !== null && (
        <EventDrawer event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      )}
    </section>
  );
}

// ---------------------------------------------------------------- //
// Filters
// ---------------------------------------------------------------- //

interface FilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  artistFilter: string;
  onArtistFilterChange: (value: string) => void;
  region: RegionFilter;
  onRegionChange: (value: RegionFilter) => void;
  source: SourceFilter;
  onSourceChange: (value: SourceFilter) => void;
}

function FilterBar({
  search,
  onSearchChange,
  artistFilter,
  onArtistFilterChange,
  region,
  onRegionChange,
  source,
  onSourceChange,
}: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="search"
        placeholder="Search title or venue"
        value={search}
        onChange={(e) => onSearchChange(e.currentTarget.value)}
        className="flex-1 rounded-md border border-border bg-bg-base px-3 py-2 text-sm focus:border-accent-cta focus:outline-none"
        style={{ minWidth: "200px", color: "var(--text-primary)" }}
        aria-label="Search title or venue"
      />
      <input
        type="search"
        placeholder="Filter by artist"
        value={artistFilter}
        onChange={(e) => onArtistFilterChange(e.currentTarget.value)}
        className="rounded-md border border-border bg-bg-base px-3 py-2 text-sm focus:border-accent-cta focus:outline-none"
        style={{ minWidth: "160px", color: "var(--text-primary)" }}
        aria-label="Filter by artist"
      />
      <RegionPills region={region} onChange={onRegionChange} />
      <SourcePills source={source} onChange={onSourceChange} />
    </div>
  );
}

const REGION_OPTIONS: ReadonlyArray<{ id: RegionFilter; label: string }> = [
  { id: "all", label: "All regions" },
  { id: "Milwaukee", label: "Milwaukee" },
  { id: "Madison", label: "Madison" },
  { id: "Chicago", label: "Chicago" },
];

function RegionPills({
  region,
  onChange,
}: {
  region: RegionFilter;
  onChange: (value: RegionFilter) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-border bg-bg-base p-1">
      {REGION_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className="rounded px-2 py-1 text-xs"
          style={{
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.04em",
            background: region === option.id ? "var(--bg-elevated)" : "transparent",
            color: region === option.id ? "var(--text-primary)" : "var(--text-muted)",
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

const SOURCE_OPTIONS: ReadonlyArray<{ id: SourceFilter; label: string }> = [
  { id: "all", label: "All sources" },
  { id: "ticketmaster", label: "TM" },
  { id: "axs", label: "AXS" },
  { id: "custom", label: "Custom" },
];

function SourcePills({
  source,
  onChange,
}: {
  source: SourceFilter;
  onChange: (value: SourceFilter) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded-md border border-border bg-bg-base p-1">
      {SOURCE_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className="rounded px-2 py-1 text-xs"
          style={{
            fontFamily: "var(--font-mono)",
            letterSpacing: "0.04em",
            background: source === option.id ? "var(--bg-elevated)" : "transparent",
            color: source === option.id ? "var(--text-primary)" : "var(--text-muted)",
          }}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function RotationToggle({
  value,
  onChange,
}: {
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.currentTarget.checked)}
        className="h-3.5 w-3.5 cursor-pointer"
      />
      <span
        className="uppercase tracking-wider text-text-muted"
        style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}
      >
        In rotation only
      </span>
    </label>
  );
}

// ---------------------------------------------------------------- //
// Grouped list rendering
// ---------------------------------------------------------------- //

interface DateGroupShape {
  dateLabel: string;
  events: EventRow[];
}

function DateGroup({
  group,
  onSelect,
}: {
  group: DateGroupShape;
  onSelect: (event: EventRow) => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      <h2
        className="text-xs font-semibold uppercase tracking-wider text-text-muted"
        style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.08em" }}
      >
        {group.dateLabel}
      </h2>
      <ul className="flex flex-col gap-2" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {group.events.map((event) => (
          <EventRow key={event.eventId} event={event} onSelect={() => onSelect(event)} />
        ))}
      </ul>
    </div>
  );
}

function EventRow({ event, onSelect }: { event: EventRow; onSelect: () => void }) {
  const dateLabel = formatTime(event.startsAtMs, event.dateOnly);
  const headlinerLabel = event.headliners.length > 0 ? event.headliners.join(", ") : null;
  const hasSupports = event.supports.length > 0;

  return (
    <li
      className="cursor-pointer rounded-md border border-border bg-bg-surface p-3 transition-colors hover:border-text-muted"
      style={event.hasRotationMatch ? { borderLeft: "3px solid var(--accent-live)" } : undefined}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
    >
      <div className="flex gap-3">
        {event.imageUrl !== null && (
          <img
            src={event.imageUrl}
            alt=""
            className="rounded"
            style={{ width: "96px", height: "54px", objectFit: "cover", flexShrink: 0 }}
            loading="lazy"
            decoding="async"
          />
        )}
        <div className="flex flex-1 flex-col gap-1" style={{ minWidth: 0 }}>
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
              {event.title ?? headlinerLabel ?? event.venueName}
            </span>
            <SourcePill source={event.source} />
            {event.hasRotationMatch && (
              <span
                className="text-xs uppercase"
                style={{
                  fontFamily: "var(--font-mono)",
                  letterSpacing: "0.06em",
                  color: "var(--accent-live-hover)",
                }}
              >
                in rotation
              </span>
            )}
          </div>
          {(headlinerLabel !== null || hasSupports) && (
            <div className="text-xs" style={{ color: "var(--text-secondary)" }}>
              {headlinerLabel !== null && <span>{headlinerLabel}</span>}
              {hasSupports && (
                <span style={{ color: "var(--text-muted)" }}>
                  {headlinerLabel !== null ? " · " : ""}with {event.supports.join(", ")}
                </span>
              )}
            </div>
          )}
          <div className="text-sm" style={{ color: "var(--text-secondary)" }}>
            <span style={{ color: "var(--text-primary)" }}>{event.venueName}</span>
            {" · "}
            {event.city}
            {event.region ? `, ${event.region}` : ""}
            {" · "}
            <span style={{ fontFamily: "var(--font-mono)" }}>{dateLabel}</span>
          </div>
        </div>
        {event.ticketUrl !== null && (
          <a
            href={event.ticketUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="self-center rounded-md px-3 py-1.5 text-xs font-semibold uppercase"
            style={{
              border: "1px solid var(--accent-cta)",
              color: "var(--accent-cta)",
              letterSpacing: "0.04em",
              whiteSpace: "nowrap",
            }}
          >
            Tickets
          </a>
        )}
      </div>
    </li>
  );
}

function SourcePill({ source }: { source: EventRow["source"] }) {
  const label = source === "ticketmaster" ? "TM" : source === "axs" ? "AXS" : "Custom";
  return (
    <span
      className="rounded px-1.5 py-0.5 text-xs"
      style={{
        fontFamily: "var(--font-mono)",
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        background: "var(--bg-elevated)",
        color: "var(--text-muted)",
      }}
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------- //
// Event detail drawer
// ---------------------------------------------------------------- //

function EventDrawer({ event, onClose }: { event: EventRow; onClose: () => void }) {
  // Close on Escape; lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  const dateLabel = formatFullDate(event.startsAtMs, event.dateOnly);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Event details"
      className="fixed inset-0 z-50 flex justify-end"
      onClick={onClose}
    >
      <div
        className="absolute inset-0"
        style={{ background: "rgba(0, 0, 0, 0.5)" }}
        aria-hidden="true"
      />
      <aside
        className="relative flex h-full w-full max-w-md flex-col gap-4 overflow-y-auto border-l border-border bg-bg-surface p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-3">
          <h2
            className="text-xl font-semibold tracking-tight"
            style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
          >
            {event.title ?? event.headliners.join(", ") ?? event.venueName}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md border border-border px-2 py-1 text-sm text-text-muted hover:border-text-primary hover:text-text-primary"
          >
            ✕
          </button>
        </header>

        {event.imageUrl !== null && (
          <img
            src={event.imageUrl}
            alt=""
            style={{ width: "100%", borderRadius: "var(--radius-md)", objectFit: "cover" }}
            loading="lazy"
          />
        )}

        <DrawerSection label="When">
          <p className="text-sm" style={{ color: "var(--text-primary)" }}>
            {dateLabel}
          </p>
        </DrawerSection>

        <DrawerSection label="Where">
          <p className="text-sm" style={{ color: "var(--text-primary)" }}>
            {event.venueName}
          </p>
          <p className="text-sm" style={{ color: "var(--text-secondary)" }}>
            {event.city}
            {event.region ? `, ${event.region}` : ""}
          </p>
        </DrawerSection>

        {event.headliners.length > 0 && (
          <DrawerSection label="Headliner">
            {event.headliners.map((name, i) => (
              <p key={i} className="text-sm" style={{ color: "var(--text-primary)" }}>
                {name}
              </p>
            ))}
          </DrawerSection>
        )}

        {event.supports.length > 0 && (
          <DrawerSection label="Support">
            {event.supports.map((name, i) => (
              <p key={i} className="text-sm" style={{ color: "var(--text-primary)" }}>
                {name}
              </p>
            ))}
          </DrawerSection>
        )}

        {event.genre !== null && (
          <DrawerSection label="Genre">
            <p className="text-sm" style={{ color: "var(--text-primary)" }}>
              {event.genre}
            </p>
          </DrawerSection>
        )}

        <DrawerSection label="Source">
          <p className="text-sm capitalize" style={{ color: "var(--text-primary)" }}>
            {event.source}
            {event.status !== null ? ` · ${event.status}` : ""}
          </p>
        </DrawerSection>

        {event.hasRotationMatch && (
          <DrawerSection label="Rotation">
            <p
              className="text-sm uppercase"
              style={{
                fontFamily: "var(--font-mono)",
                letterSpacing: "0.06em",
                color: "var(--accent-live-hover)",
              }}
            >
              At least one performer is in rotation
            </p>
          </DrawerSection>
        )}

        {event.ticketUrl !== null && (
          <a
            href={event.ticketUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="self-start rounded-md px-4 py-2 text-sm font-semibold uppercase"
            style={{
              border: "1px solid var(--accent-cta)",
              color: "var(--accent-cta)",
              letterSpacing: "0.04em",
            }}
          >
            Get tickets
          </a>
        )}
      </aside>
    </div>
  );
}

function DrawerSection({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-1">
      <h3
        className="text-xs font-semibold uppercase tracking-wider text-text-muted"
        style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.08em" }}
      >
        {label}
      </h3>
      {children}
    </section>
  );
}

// ---------------------------------------------------------------- //
// Loading / Empty
// ---------------------------------------------------------------- //

function EventsLoading() {
  return (
    <ul className="flex flex-col gap-2" style={{ listStyle: "none", margin: 0, padding: 0 }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <li
          key={i}
          className="rounded-md border border-border bg-bg-surface"
          style={{ height: "82px", opacity: 0.6 }}
          aria-hidden="true"
        />
      ))}
    </ul>
  );
}

function EventsEmpty({ hasFilters }: { hasFilters: boolean }) {
  return (
    <p className="rounded-md border border-border bg-bg-base p-4 text-sm text-text-muted">
      {hasFilters
        ? "No events match those filters. Clear them or widen the search."
        : "No upcoming events. The Ticketmaster cron may not have run yet, or the next 90 days really are quiet."}
    </p>
  );
}

// ---------------------------------------------------------------- //
// Helpers
// ---------------------------------------------------------------- //

const MILWAUKEE_TIMEZONE = "America/Chicago";

const DAY_HEADER_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "short",
  day: "numeric",
  timeZone: MILWAUKEE_TIMEZONE,
});

const DAY_KEY_FMT = new Intl.DateTimeFormat("en-CA", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  timeZone: MILWAUKEE_TIMEZONE,
});

const TIME_FMT = new Intl.DateTimeFormat(undefined, {
  hour: "numeric",
  minute: "2-digit",
  timeZone: MILWAUKEE_TIMEZONE,
});

const FULL_DATE_FMT = new Intl.DateTimeFormat(undefined, {
  weekday: "long",
  month: "long",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  timeZone: MILWAUKEE_TIMEZONE,
});

function formatTime(startsAtMs: number, dateOnly: boolean): string {
  if (dateOnly) return "Time TBD";
  return TIME_FMT.format(new Date(startsAtMs));
}

function formatFullDate(startsAtMs: number, dateOnly: boolean): string {
  if (dateOnly) {
    return DAY_HEADER_FMT.format(new Date(startsAtMs));
  }
  return FULL_DATE_FMT.format(new Date(startsAtMs));
}

/**
 * Group events by their Milwaukee-local calendar day. Already-sorted-by-
 * startsAt input means we can fold sequentially without sorting groups.
 */
function groupByDate(events: readonly EventRow[]): DateGroupShape[] {
  const groups: DateGroupShape[] = [];
  let currentKey: string | null = null;
  let currentGroup: DateGroupShape | null = null;
  for (const event of events) {
    const d = new Date(event.startsAtMs);
    const key = DAY_KEY_FMT.format(d);
    if (key !== currentKey) {
      currentKey = key;
      currentGroup = {
        dateLabel: DAY_HEADER_FMT.format(d),
        events: [],
      };
      groups.push(currentGroup);
    }
    currentGroup!.events.push(event);
  }
  return groups;
}

const CSV_DATE_FMT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
  timeZone: MILWAUKEE_TIMEZONE,
});

/**
 * CSV export. Columns chosen for the music-director use case ("paste
 * into a feature pitch deck" or "share with the on-air talent"):
 * Date, Show Title, Venue, City, Region, Headliners, Supports,
 * In Rotation, Source, Status, Tickets URL.
 *
 * Quoting: every field is double-quote wrapped; embedded quotes are
 * doubled per RFC 4180.
 */
function toCsv(events: readonly EventRow[]): string {
  const header = [
    "Date",
    "Show Title",
    "Venue",
    "City",
    "Region",
    "Headliners",
    "Supports",
    "In Rotation",
    "Source",
    "Status",
    "Tickets URL",
  ];
  const body = events.map((e) => [
    e.dateOnly
      ? DAY_KEY_FMT.format(new Date(e.startsAtMs))
      : CSV_DATE_FMT.format(new Date(e.startsAtMs)),
    e.title ?? "",
    e.venueName,
    e.city,
    e.region,
    e.headliners.join("; "),
    e.supports.join("; "),
    e.hasRotationMatch ? "yes" : "no",
    e.source,
    e.status ?? "",
    e.ticketUrl ?? "",
  ]);
  return [header, ...body].map((row) => row.map(csvEscape).join(",")).join("\n");
}

function csvEscape(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function downloadCsv(content: string, filename: string): void {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Tiny debounce hook. Inlined to keep this page self-contained.
 */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}
