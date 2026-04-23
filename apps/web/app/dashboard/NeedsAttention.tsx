"use client";

import { useQuery } from "convex/react";
import { api } from "@rm/convex/api";

/**
 * Row 2 right panel — "Needs Attention" per DESIGN.md 002 section C.
 *
 * Subscribes to `ingestionEvents.recentProblems`. Empty result is a
 * feature (operators see it most of the time) — the copy "Everything is
 * clean" is deliberate and not happy-talk.
 */
export function NeedsAttention() {
  const problems = useQuery(api.ingestionEvents.recentProblems, { limit: 8 });

  return (
    <section
      role="region"
      aria-label="Items needing attention"
      className="flex flex-col gap-3 rounded-md border border-border bg-bg-surface p-5"
    >
      <header className="flex items-center justify-between">
        <h3 className="text-sm font-semibold tracking-tight">Needs Attention</h3>
        {problems !== undefined && problems.length > 0 && (
          <span
            className="rounded-full bg-status-error/20 px-2 py-0.5 text-xs font-medium text-status-error"
            style={{ fontFamily: "var(--font-mono)" }}
          >
            {problems.length}
          </span>
        )}
      </header>

      {problems === undefined && (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-6 animate-pulse rounded-sm bg-bg-elevated" />
          ))}
        </div>
      )}

      {problems !== undefined && problems.length === 0 && (
        <p className="text-sm text-text-muted">
          Everything is clean.{" "}
          <span className="text-xs text-text-muted/70" style={{ fontFamily: "var(--font-mono)" }}>
            Last checked just now.
          </span>
        </p>
      )}

      {problems !== undefined && problems.length > 0 && (
        <ul role="list" className="flex flex-col gap-1.5">
          {problems.map((p) => (
            <li
              key={p._id}
              className="flex items-start justify-between gap-3 rounded-sm px-2 py-1.5 text-xs transition-colors duration-[var(--dur-micro)] hover:bg-bg-elevated"
            >
              <div className="flex min-w-0 items-start gap-2">
                <KindDot kind={p.kind} />
                <div className="min-w-0">
                  <p className="truncate text-text-primary">{p.message}</p>
                  <p className="text-text-muted">{p.station}</p>
                </div>
              </div>
              <time
                dateTime={new Date(p.createdAt).toISOString()}
                className="shrink-0 text-text-muted"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {formatRelative(p.createdAt)}
              </time>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function KindDot({ kind }: { kind: string }) {
  const severity = severityOf(kind);
  const bgClass: Record<Severity, string> = {
    error: "bg-status-error",
    warn: "bg-status-warn",
    info: "bg-status-info",
  };
  return (
    <span
      aria-hidden
      className={`mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full ${bgClass[severity]}`}
    />
  );
}

type Severity = "error" | "warn" | "info";
function severityOf(kind: string): Severity {
  if (kind === "poll_error" || kind === "enrichment_error") return "error";
  if (kind === "drift_detected" || kind === "source_paused") return "warn";
  return "info";
}

function formatRelative(epochMs: number): string {
  const ageSec = Math.floor((Date.now() - epochMs) / 1000);
  if (ageSec < 10) return "just now";
  if (ageSec < 60) return `${ageSec}s`;
  const ageMin = Math.floor(ageSec / 60);
  if (ageMin < 60) return `${ageMin}m`;
  const ageHr = Math.floor(ageMin / 60);
  if (ageHr < 24) return `${ageHr}h`;
  return `${Math.floor(ageHr / 24)}d`;
}
