import type { FundraiserProgressConfig } from "@/lib/blocks";
import { formatUsd } from "@/lib/format";

/**
 * Manual fundraiser-progress block (design doc 005, Phase 5). Staff enter goal,
 * raised, and a donate link; there's no live donation integration. Renders an
 * on-theme progress bar (CSS vars) + a donate CTA. Percent is clamped to 0–100
 * and a goal of 0 reads as 0% (no divide-by-zero).
 */
export function FundraiserProgress({ config }: { config: FundraiserProgressConfig }) {
  const { goal, raised, donateHref, title, caption } = config;
  const pct = goal > 0 ? Math.min(100, Math.max(0, Math.round((raised / goal) * 100))) : 0;

  return (
    <section className="px-6 py-10">
      <div
        className="mx-auto flex max-w-2xl flex-col gap-5 px-6 py-7"
        style={{ background: "var(--rm-color-card)", borderRadius: "var(--rm-radius)" }}
      >
        {title !== undefined && title.length > 0 && (
          <h2 className="text-xl font-bold tracking-tight">{title}</h2>
        )}

        <div className="flex flex-col gap-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-2xl font-bold" style={{ color: "var(--rm-color-accent)" }}>
              {formatUsd(raised)}
            </span>
            <span className="text-sm opacity-70">raised of {formatUsd(goal)} goal</span>
          </div>

          {/* Track + fill. aria attributes expose progress to assistive tech. */}
          <div
            className="h-3 w-full overflow-hidden"
            style={{
              background: "color-mix(in srgb, var(--rm-color-text) 12%, transparent)",
              borderRadius: "var(--rm-radius)",
            }}
            role="progressbar"
            aria-valuenow={pct}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Fundraiser progress"
          >
            <div
              className="h-full"
              style={{
                width: `${pct}%`,
                background: "var(--rm-color-accent)",
                borderRadius: "var(--rm-radius)",
              }}
            />
          </div>
          <span className="text-xs font-medium opacity-70">{pct}% of goal</span>
        </div>

        {caption !== undefined && caption.length > 0 && (
          <p className="text-sm opacity-80">{caption}</p>
        )}

        <a
          href={donateHref}
          className="inline-flex items-center justify-center px-5 py-2.5 text-sm font-semibold"
          style={{
            borderRadius: "var(--rm-radius)",
            background: "var(--rm-color-accent)",
            color: "#fff",
          }}
        >
          Donate
        </a>
      </div>
    </section>
  );
}
