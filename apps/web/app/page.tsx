"use client";

import Link from "next/link";
import { SignedIn, SignedOut } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { api } from "@rm/convex/api";
import { useMemo, useState } from "react";

/**
 * PlaylistFM landing page (playlistfm.app).
 *
 * Editorial-broadcast aesthetic per DESIGN.md — light mode public
 * surface, warm-off-white background, deep charcoal text. The product
 * IS the demo: four live now-playing cards sit where a SaaS landing
 * would put a hero illustration. Most products can't show real-time
 * music data on their homepage; we can, so we lead with it.
 *
 * Auth-aware footer CTAs. Anonymous visitors see Sign in; signed-in
 * users see Go to dashboard.
 */
export default function Home() {
  return (
    <div
      data-theme="light"
      className="flex min-h-screen flex-col"
      style={{ background: "var(--bg-base)", color: "var(--text-primary)" }}
    >
      <TopBar />
      <Hero />
      <LiveStreams />
      <Features />
      <OperatorSection />
      <EmbedSection />
      <Footer />
    </div>
  );
}

// ---------------------------------------------------------------- //
// Top bar
// ---------------------------------------------------------------- //

function TopBar() {
  return (
    <header
      className="flex items-center justify-between px-6 py-4"
      style={{ borderBottom: "1px solid var(--border)" }}
    >
      <div className="flex flex-col gap-0.5">
        <span
          style={{
            fontFamily: "var(--font-display)",
            fontSize: "18px",
            fontWeight: 700,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            lineHeight: 1,
          }}
        >
          PlaylistFM
        </span>
        <span
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "10px",
            fontWeight: 500,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
            lineHeight: 1,
          }}
        >
          Powered by Radio Milwaukee
        </span>
      </div>
      <div className="flex items-center gap-4 text-sm">
        <SignedOut>
          <Link
            href="/sign-in"
            className="hover:underline"
            style={{ color: "var(--text-primary)" }}
          >
            Sign in
          </Link>
        </SignedOut>
        <SignedIn>
          <Link
            href="/dashboard"
            className="hover:underline"
            style={{ color: "var(--text-primary)" }}
          >
            Dashboard →
          </Link>
        </SignedIn>
      </div>
    </header>
  );
}

// ---------------------------------------------------------------- //
// Hero
// ---------------------------------------------------------------- //

function Hero() {
  return (
    <section className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-16 md:py-24">
      <h1
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "clamp(40px, 8vw, 72px)",
          fontWeight: 700,
          lineHeight: 1.05,
          letterSpacing: "-0.02em",
        }}
      >
        What&apos;s playing now.
        <br />
        <span style={{ color: "var(--accent-cta)" }}>Where they&apos;re playing next.</span>
      </h1>
      <p
        className="max-w-2xl"
        style={{
          fontSize: "18px",
          lineHeight: 1.55,
          color: "var(--text-secondary)",
        }}
      >
        Real-time playlist data plus tour-date discovery for public radio. Embeddable on any partner
        station&apos;s site, with one script tag.
      </p>
    </section>
  );
}

// ---------------------------------------------------------------- //
// Live streams (the demo)
// ---------------------------------------------------------------- //

const STATIONS = [
  { slug: "88nine" as const, label: "88Nine" },
  { slug: "hyfin" as const, label: "HYFIN" },
  { slug: "rhythmlab" as const, label: "Rhythm Lab" },
  { slug: "414music" as const, label: "414 Music" },
];

function LiveStreams() {
  return (
    <section
      className="px-6 py-12"
      style={{ borderTop: "1px solid var(--border)", background: "var(--bg-surface)" }}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <header className="flex items-center justify-between">
          <h2
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
            }}
          >
            On air across all four streams
          </h2>
          <span
            className="flex items-center gap-2"
            style={{ fontFamily: "var(--font-mono)", fontSize: "11px", color: "var(--text-muted)" }}
          >
            <LivePulseDot />
            Real-time
          </span>
        </header>
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {STATIONS.map((station) => (
            <LiveCard key={station.slug} slug={station.slug} label={station.label} />
          ))}
        </div>
      </div>
    </section>
  );
}

function LiveCard({
  slug,
  label,
}: {
  slug: "hyfin" | "88nine" | "414music" | "rhythmlab";
  label: string;
}) {
  const play = useQuery(api.plays.currentByStation, { stationSlug: slug });

  return (
    <article
      className="flex items-center gap-4 rounded-md p-4"
      style={{
        background: "var(--bg-base)",
        border: "1px solid var(--border)",
      }}
    >
      <AlbumArt
        src={play?.artworkUrl ?? null}
        alt={play ? `${play.title} — ${play.artist}` : label}
        size={72}
      />
      <div className="flex flex-1 flex-col gap-0.5" style={{ minWidth: 0 }}>
        <div
          className="flex items-center gap-2"
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "11px",
            fontWeight: 600,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: "8px",
              height: "8px",
              borderRadius: "9999px",
              background: "var(--accent-cta)",
              display: "inline-block",
            }}
          />
          {label}
        </div>
        {play === undefined ? (
          <LiveCardSkeleton />
        ) : play === null ? (
          <p style={{ fontSize: "14px", color: "var(--text-muted)" }}>Off the air.</p>
        ) : (
          <>
            <p
              style={{
                fontSize: "16px",
                fontWeight: 600,
                color: "var(--text-primary)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {play.title}
            </p>
            <p
              style={{
                fontSize: "14px",
                color: "var(--text-secondary)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {play.artist}
            </p>
          </>
        )}
      </div>
    </article>
  );
}

function LiveCardSkeleton() {
  return (
    <div className="flex flex-col gap-1.5">
      <div
        style={{
          height: "16px",
          width: "70%",
          background: "var(--bg-elevated)",
          borderRadius: "var(--radius-sm)",
          opacity: 0.6,
        }}
        aria-hidden="true"
      />
      <div
        style={{
          height: "12px",
          width: "50%",
          background: "var(--bg-elevated)",
          borderRadius: "var(--radius-sm)",
          opacity: 0.6,
        }}
        aria-hidden="true"
      />
    </div>
  );
}

function LivePulseDot() {
  return (
    <span
      aria-hidden="true"
      style={{
        width: "8px",
        height: "8px",
        borderRadius: "9999px",
        background: "var(--accent-live)",
        display: "inline-block",
        boxShadow: "0 0 0 0 var(--accent-live)",
        animation: "live-pulse 2s ease-in-out infinite",
      }}
    />
  );
}

function AlbumArt({ src, alt, size }: { src: string | null; alt: string; size: number }) {
  const style: React.CSSProperties = {
    width: `${size}px`,
    height: `${size}px`,
    background: "var(--bg-elevated)",
    border: "1px solid var(--border)",
    flexShrink: 0,
    objectFit: "cover",
    display: "block",
  };
  if (src === null) {
    return <div style={style} role="img" aria-label={alt} />;
  }
  const pixelSize = String(size * 2);
  const materialized = src
    .replace(/\{w\}|%7Bw%7D/g, pixelSize)
    .replace(/\{h\}|%7Bh%7D/g, pixelSize);
  return <img src={materialized} alt={alt} style={style} loading="lazy" decoding="async" />;
}

// ---------------------------------------------------------------- //
// Features
// ---------------------------------------------------------------- //

function Features() {
  return (
    <section className="mx-auto w-full max-w-5xl px-6 py-16">
      <div className="grid grid-cols-1 gap-12 md:grid-cols-3">
        <Feature
          number="01"
          title="Real-time."
          body="Plays update via WebSocket the moment they air. No polling, no refresh. Listeners hear it on the radio and see it on the page in the same breath."
        />
        <Feature
          number="02"
          title="See them live."
          body="When an artist on rotation has an upcoming local show, the LIVE event row surfaces inline beneath their play. Powered by Ticketmaster and AXS, deduped across sources."
        />
        <Feature
          number="03"
          title="Public-radio quality."
          body="WCAG 2.2 AA accessible by default. Embeddable on any partner site with one script tag. No autoplay, no tracking pixels, no SaaS-cliché design."
        />
      </div>
    </section>
  );
}

function Feature({ number, title, body }: { number: string; title: string; body: string }) {
  return (
    <div className="flex flex-col gap-3">
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "12px",
          fontWeight: 600,
          letterSpacing: "0.08em",
          color: "var(--accent-cta)",
        }}
      >
        {number}
      </span>
      <h3
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "24px",
          fontWeight: 700,
          lineHeight: 1.2,
        }}
      >
        {title}
      </h3>
      <p style={{ fontSize: "16px", lineHeight: 1.6, color: "var(--text-secondary)" }}>{body}</p>
    </div>
  );
}

// ---------------------------------------------------------------- //
// Operator section — what music directors and ops staff get
// ---------------------------------------------------------------- //

function OperatorSection() {
  return (
    <section
      className="px-6 py-16"
      style={{ borderTop: "1px solid var(--border)", background: "var(--bg-surface)" }}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10">
        <header className="flex flex-col gap-3">
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontSize: "12px",
              fontWeight: 600,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: "var(--text-muted)",
            }}
          >
            For station operators
          </span>
          <h2
            style={{
              fontFamily: "var(--font-display)",
              fontSize: "clamp(28px, 5vw, 44px)",
              fontWeight: 700,
              lineHeight: 1.15,
              letterSpacing: "-0.01em",
              maxWidth: "720px",
            }}
          >
            The dashboard music directors actually want to open.
          </h2>
          <p
            className="max-w-2xl"
            style={{
              fontSize: "16px",
              lineHeight: 1.6,
              color: "var(--text-secondary)",
            }}
          >
            Built for the daily reality of public-radio ops: ingest from multiple sources, triage
            what didn&apos;t resolve, surface what&apos;s touring, export what SoundExchange wants.
            Designed for long sessions, ops-dense, dark by default.
          </p>
        </header>
        <div className="grid grid-cols-1 gap-x-10 gap-y-8 md:grid-cols-2">
          <OperatorFeature
            label="Wall-of-status"
            title="Every stream at a glance."
            body="Four station cards subscribe live to your feeds. Health dots, coverage stats, what's currently playing — all in real time. No refresh button anywhere."
          />
          <OperatorFeature
            label="Needs Attention"
            title="Triage what didn't resolve."
            body="Enrichment failures grouped by reason — retry, edit, or ignore inline. The music director's morning ritual takes 90 seconds, not 30 minutes."
          />
          <OperatorFeature
            label="NPR / SoundExchange export"
            title="Music-rights reporting in two clicks."
            body="Pick a station, pick a date range, download. Tab-delimited UTF-8, Milwaukee local time, NPR's playlist log format. Auto-fills durations from Apple Music when sources skip them."
          />
          <OperatorFeature
            label="Touring from rotation"
            title="Plug a tour from a play."
            body="Artists in your last-30-days rotation who have upcoming local shows surface in a dedicated panel. The 'see them tonight' opportunity, but for the air-staff side."
          />
          <OperatorFeature
            label="Events browse"
            title="850 upcoming shows, filter your way."
            body="Every concert Ticketmaster (and AXS, when wired) has fed into the system. Search by artist, venue, region, source. Click any row for full details. Export the filtered set as CSV."
          />
          <OperatorFeature
            label="Public-radio operator UX"
            title="Designed for the people running it."
            body="WCAG 2.2 AA accessible. Dark by default for long sessions. Editorial-broadcast aesthetic, not SaaS-cliché. Every detail tested with real Milwaukee operators."
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-2">
          <SignedOut>
            <Link
              href="/sign-in"
              className="rounded-md px-4 py-2 text-sm font-semibold uppercase"
              style={{
                background: "var(--accent-cta)",
                color: "var(--bg-base)",
                letterSpacing: "0.04em",
                fontFamily: "var(--font-mono)",
              }}
            >
              Sign in to the dashboard
            </Link>
          </SignedOut>
          <SignedIn>
            <Link
              href="/dashboard"
              className="rounded-md px-4 py-2 text-sm font-semibold uppercase"
              style={{
                background: "var(--accent-cta)",
                color: "var(--bg-base)",
                letterSpacing: "0.04em",
                fontFamily: "var(--font-mono)",
              }}
            >
              Open the dashboard →
            </Link>
          </SignedIn>
          <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>
            Authenticated via Clerk · Single-tenant during shakedown
          </span>
        </div>
      </div>
    </section>
  );
}

function OperatorFeature({ label, title, body }: { label: string; title: string; body: string }) {
  return (
    <div className="flex flex-col gap-2">
      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "11px",
          fontWeight: 600,
          letterSpacing: "0.1em",
          textTransform: "uppercase",
          color: "var(--accent-live-hover)",
        }}
      >
        {label}
      </span>
      <h3
        style={{
          fontFamily: "var(--font-display)",
          fontSize: "20px",
          fontWeight: 700,
          lineHeight: 1.25,
          color: "var(--text-primary)",
        }}
      >
        {title}
      </h3>
      <p style={{ fontSize: "15px", lineHeight: 1.55, color: "var(--text-secondary)" }}>{body}</p>
    </div>
  );
}

// ---------------------------------------------------------------- //
// Embed section
// ---------------------------------------------------------------- //

const EMBED_SNIPPET = `<div data-rmke-widget data-station="hyfin" data-variant="now-playing-card"></div>
<script type="module" src="https://embed.playlistfm.app/v1/widget.js"></script>`;

function EmbedSection() {
  const [copied, setCopied] = useState(false);
  const onCopy = useMemo(
    () => async () => {
      try {
        await navigator.clipboard.writeText(EMBED_SNIPPET);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      } catch {
        // clipboard API rejected — graceful degradation, no toast
      }
    },
    [],
  );

  return (
    <section
      className="px-6 py-16"
      style={{ borderTop: "1px solid var(--border)", background: "var(--bg-surface)" }}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <h2
          style={{
            fontFamily: "var(--font-mono)",
            fontSize: "12px",
            fontWeight: 600,
            letterSpacing: "0.12em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          Embed
        </h2>
        <p
          className="max-w-2xl"
          style={{ fontSize: "18px", lineHeight: 1.55, color: "var(--text-primary)" }}
        >
          Drop two tags on any page. The widget renders inside a shadow root — host CSS can&apos;t
          reach in, your tokens can&apos;t reach out.
        </p>
        <div
          className="relative rounded-md p-5"
          style={{
            background: "var(--bg-base)",
            border: "1px solid var(--border)",
            fontFamily: "var(--font-mono)",
            fontSize: "13px",
            lineHeight: 1.6,
            color: "var(--text-primary)",
            overflowX: "auto",
          }}
        >
          <button
            type="button"
            onClick={onCopy}
            className="absolute right-3 top-3 rounded px-2 py-1 text-[10px] uppercase"
            style={{
              fontFamily: "var(--font-mono)",
              letterSpacing: "0.06em",
              border: "1px solid var(--border)",
              color: copied ? "var(--accent-cta)" : "var(--text-muted)",
              background: "var(--bg-surface)",
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <pre style={{ margin: 0, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
            {EMBED_SNIPPET}
          </pre>
        </div>
        <p style={{ fontSize: "14px", color: "var(--text-muted)" }}>
          Variants: <code style={{ fontFamily: "var(--font-mono)" }}>now-playing-card</code>,{" "}
          <code style={{ fontFamily: "var(--font-mono)" }}>now-playing-strip</code>,{" "}
          <code style={{ fontFamily: "var(--font-mono)" }}>playlist</code>. Stations:{" "}
          <code style={{ fontFamily: "var(--font-mono)" }}>hyfin</code>,{" "}
          <code style={{ fontFamily: "var(--font-mono)" }}>88nine</code>,{" "}
          <code style={{ fontFamily: "var(--font-mono)" }}>414music</code>,{" "}
          <code style={{ fontFamily: "var(--font-mono)" }}>rhythmlab</code>.
        </p>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------- //
// Footer
// ---------------------------------------------------------------- //

function Footer() {
  return (
    <footer
      className="mt-auto px-6 py-8"
      style={{ borderTop: "1px solid var(--border)", color: "var(--text-muted)" }}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4 text-sm">
        <span style={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}>
          Made with{" "}
          <span
            aria-label="love"
            role="img"
            style={{ color: "var(--accent-cta)", display: "inline-block", margin: "0 2px" }}
          >
            ♥
          </span>{" "}
          by Tarik Moody
        </span>
        <div
          className="flex items-center gap-4"
          style={{ fontFamily: "var(--font-mono)", fontSize: "12px" }}
        >
          <SignedOut>
            <Link
              href="/sign-in"
              style={{ color: "var(--text-muted)" }}
              className="hover:underline"
            >
              Sign in
            </Link>
          </SignedOut>
          <SignedIn>
            <Link
              href="/dashboard"
              style={{ color: "var(--text-muted)" }}
              className="hover:underline"
            >
              Dashboard
            </Link>
          </SignedIn>
          <a
            href="https://github.com/tmoody1973/rm-playlist-v2"
            target="_blank"
            rel="noopener noreferrer"
            style={{ color: "var(--text-muted)" }}
            className="hover:underline"
          >
            Source
          </a>
        </div>
      </div>
    </footer>
  );
}
