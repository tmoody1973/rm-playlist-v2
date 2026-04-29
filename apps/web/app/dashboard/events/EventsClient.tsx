"use client";

import { useEffect, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@rm/convex/api";
import type { FunctionReturnType } from "convex/server";

type EventRow = FunctionReturnType<typeof api.events.allUpcomingEvents>[number];
type SourceFilter = "all" | "ticketmaster" | "axs" | "custom";
type RegionFilter = "all" | "Milwaukee" | "Madison" | "Chicago";

/**
 * Client component for the /dashboard/events browse page.
 *
 * Filters live in component state (could promote to URL params if the
 * music director wants shareable views later). Search is debounced 200ms
 * so typing doesn't fire a Convex re-query per keystroke. Each filter
 * change triggers a fresh useQuery subscription — Convex caches by args
 * so flipping back-and-forth is instant.
 */
export function EventsClient() {
  const [search, setSearch] = useState("");
  const [region, setRegion] = useState<RegionFilter>("all");
  const [source, setSource] = useState<SourceFilter>("all");

  const debouncedSearch = useDebounced(search, 200);

  const events = useQuery(api.events.allUpcomingEvents, {
    orgSlug: "radiomilwaukee",
    horizonDays: 90,
    limit: 200,
    search: debouncedSearch.trim().length > 0 ? debouncedSearch : undefined,
    region: region === "all" ? undefined : region,
    source: source === "all" ? undefined : source,
  });

  return (
    <section className="flex flex-col gap-4">
      <FilterBar
        search={search}
        onSearchChange={setSearch}
        region={region}
        onRegionChange={setRegion}
        source={source}
        onSourceChange={setSource}
      />

      <div className="flex items-center justify-between text-xs text-text-muted">
        <span style={{ fontFamily: "var(--font-mono)" }}>
          {events === undefined
            ? "Loading…"
            : `${events.length} ${events.length === 1 ? "event" : "events"}`}
        </span>
        {(region !== "all" || source !== "all" || debouncedSearch.length > 0) && (
          <button
            type="button"
            onClick={() => {
              setSearch("");
              setRegion("all");
              setSource("all");
            }}
            className="text-xs uppercase tracking-wider text-text-muted hover:text-accent-cta"
            style={{ fontFamily: "var(--font-mono)", letterSpacing: "0.06em" }}
          >
            Clear filters
          </button>
        )}
      </div>

      {events === undefined ? (
        <EventsLoading />
      ) : events.length === 0 ? (
        <EventsEmpty
          hasFilters={debouncedSearch.length > 0 || region !== "all" || source !== "all"}
        />
      ) : (
        <ul className="flex flex-col gap-2" style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {events.map((event) => (
            <EventRow key={event.eventId} event={event} />
          ))}
        </ul>
      )}
    </section>
  );
}

interface FilterBarProps {
  search: string;
  onSearchChange: (value: string) => void;
  region: RegionFilter;
  onRegionChange: (value: RegionFilter) => void;
  source: SourceFilter;
  onSourceChange: (value: SourceFilter) => void;
}

function FilterBar({
  search,
  onSearchChange,
  region,
  onRegionChange,
  source,
  onSourceChange,
}: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <input
        type="search"
        placeholder="Search title or venue"
        value={search}
        onChange={(e) => onSearchChange(e.currentTarget.value)}
        className="flex-1 rounded-md border border-border bg-bg-base px-3 py-2 text-sm focus:border-accent-cta focus:outline-none"
        style={{ minWidth: "200px", color: "var(--text-primary)" }}
        aria-label="Search title or venue"
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

function EventRow({ event }: { event: EventRow }) {
  const dateLabel = formatDate(event.startsAtMs, event.dateOnly);
  const headlinerLabel = event.headliners.length > 0 ? event.headliners.join(", ") : null;
  const hasSupports = event.supports.length > 0;

  return (
    <li className="flex gap-3 rounded-md border border-border bg-bg-surface p-3">
      {event.imageUrl !== null && (
        <img
          src={event.imageUrl}
          alt=""
          className="rounded"
          style={{
            width: "96px",
            height: "54px",
            objectFit: "cover",
            flexShrink: 0,
          }}
          loading="lazy"
          decoding="async"
        />
      )}
      <div className="flex flex-1 flex-col gap-1" style={{ minWidth: 0 }}>
        <div className="flex items-baseline gap-2 flex-wrap">
          <span className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
            {event.title ?? headlinerLabel ?? event.venueName}
          </span>
          <SourcePill source={event.source} />
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

function formatDate(startsAtMs: number, dateOnly: boolean): string {
  const d = new Date(startsAtMs);
  const dateOpts: Intl.DateTimeFormatOptions = {
    month: "short",
    day: "numeric",
    timeZone: "America/Chicago",
  };
  if (dateOnly) {
    return new Intl.DateTimeFormat(undefined, dateOpts).format(d);
  }
  return new Intl.DateTimeFormat(undefined, {
    ...dateOpts,
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/Chicago",
  }).format(d);
}

/**
 * Tiny debounce hook. Inlined to keep this page self-contained — could
 * promote to a shared hooks module if anywhere else in /dashboard adopts
 * the same pattern.
 */
function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}
