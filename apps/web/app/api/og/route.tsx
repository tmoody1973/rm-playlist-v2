import { ImageResponse } from "next/og";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@rm/convex/api";

/**
 * Live OG image — generated at request time from current Convex data.
 *
 * When someone shares playlistfm.app in Slack / Twitter / iMessage, the
 * unfurl preview shows whatever is on air right now — a different image
 * every time. Most products can't do this; we can, because the data is
 * already live.
 *
 * Strategy:
 *   1. Fetch currentByStation for all 4 streams in parallel.
 *   2. Pick the station with the most recent playedAt (the freshest air).
 *   3. Render now-playing card with album art + title + artist.
 *   4. Fall back to brand-only layout if everything is null or if
 *      Convex is unreachable.
 *
 * Runtime: Edge. Cached 60s so a flurry of shares doesn't hammer
 * Convex; "real-time" at the social-share-cache cadence is plenty
 * for OG previews (most platforms cache for hours anyway).
 */

export const runtime = "edge";

const STATIONS = [
  { slug: "88nine", label: "88Nine" },
  { slug: "hyfin", label: "HYFIN" },
  { slug: "rhythmlab", label: "Rhythm Lab" },
  { slug: "414music", label: "414 Music" },
] as const;

type StationSlug = (typeof STATIONS)[number]["slug"];

type StationLabel = (typeof STATIONS)[number]["label"];

interface NowPlaying {
  station: StationSlug;
  stationLabel: StationLabel;
  title: string;
  artist: string;
  artworkUrl: string | null;
  playedAt: number;
}

const COLOR = {
  bgBase: "#F7F3EE",
  bgElevated: "#FFFFFF",
  border: "#E8E5DE",
  textPrimary: "#1A1A1A",
  textSecondary: "#6B6E73",
  textMuted: "#6E6C68",
  accentCta: "#E84F2F",
  accentLive: "#FFB81C",
};

async function loadInterFont(): Promise<ArrayBuffer | null> {
  // Geist isn't on Google Fonts; Inter is a close cousin and is the
  // most widely-available high-quality sans-serif on a CDN. Used only
  // for the OG image — the live site uses real Geist via next/font.
  try {
    const res = await fetch(
      "https://github.com/rsms/inter/raw/v3.19/docs/font-files/Inter-SemiBold.otf",
    );
    if (!res.ok) return null;
    return res.arrayBuffer();
  } catch {
    return null;
  }
}

async function loadInterRegularFont(): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(
      "https://github.com/rsms/inter/raw/v3.19/docs/font-files/Inter-Regular.otf",
    );
    if (!res.ok) return null;
    return res.arrayBuffer();
  } catch {
    return null;
  }
}

async function fetchMostRecentPlay(): Promise<NowPlaying | null> {
  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (!url) return null;

  try {
    const client = new ConvexHttpClient(url);
    const results = await Promise.all(
      STATIONS.map(async (s) => {
        const play = (await client.query(api.plays.currentByStation, {
          stationSlug: s.slug,
        })) as {
          title: string;
          artist: string;
          artworkUrl: string | null;
          playedAt: number;
        } | null;
        if (play === null) return null;
        return {
          station: s.slug,
          stationLabel: s.label,
          title: play.title,
          artist: play.artist,
          artworkUrl: play.artworkUrl,
          playedAt: play.playedAt,
        } satisfies NowPlaying;
      }),
    );
    const candidates: NowPlaying[] = [];
    for (const r of results) {
      if (r !== null) candidates.push(r);
    }
    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.playedAt - a.playedAt);
    return candidates[0] ?? null;
  } catch {
    return null;
  }
}

/**
 * Materialize Apple Music's templated artwork URL. Other sources return
 * fully-resolved URLs and the regex is a no-op for them.
 */
function materializeArtwork(url: string, size: number): string {
  const px = String(size * 2);
  return url.replace(/\{w\}|%7Bw%7D/g, px).replace(/\{h\}|%7Bh%7D/g, px);
}

export async function GET() {
  const [boldFont, regularFont, nowPlaying] = await Promise.all([
    loadInterFont(),
    loadInterRegularFont(),
    fetchMostRecentPlay(),
  ]);

  const fonts = [
    ...(regularFont !== null
      ? [{ name: "Inter", data: regularFont, weight: 400 as const, style: "normal" as const }]
      : []),
    ...(boldFont !== null
      ? [{ name: "Inter", data: boldFont, weight: 700 as const, style: "normal" as const }]
      : []),
  ];

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100%",
        height: "100%",
        background: COLOR.bgBase,
        padding: "50px 70px",
        fontFamily: "Inter, sans-serif",
      }}
    >
      {/* Top: brand (compact) */}
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "12px",
        }}
      >
        <div
          style={{
            fontSize: "28px",
            fontWeight: 700,
            letterSpacing: "0.04em",
            color: COLOR.textPrimary,
            lineHeight: 1,
          }}
        >
          PLAYLISTFM
        </div>
        <div
          style={{
            fontSize: "13px",
            fontWeight: 400,
            letterSpacing: "0.08em",
            color: COLOR.textMuted,
            lineHeight: 1,
            textTransform: "uppercase",
          }}
        >
          Powered by Radio Milwaukee
        </div>
      </div>

      {/* Middle hero: now playing — center of gravity */}
      {nowPlaying !== null ? (
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          {/* On Air badge */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              fontSize: "16px",
              fontWeight: 700,
              letterSpacing: "0.12em",
              color: COLOR.accentCta,
              textTransform: "uppercase",
              marginBottom: "28px",
            }}
          >
            <div
              style={{
                width: "12px",
                height: "12px",
                borderRadius: "9999px",
                background: COLOR.accentCta,
                marginRight: "12px",
                display: "flex",
              }}
            />
            <span style={{ display: "flex" }}>On air · {nowPlaying.stationLabel}</span>
          </div>

          {/* Art + track row */}
          <div style={{ display: "flex", alignItems: "center" }}>
            {nowPlaying.artworkUrl !== null ? (
              <img
                src={materializeArtwork(nowPlaying.artworkUrl, 220)}
                width={220}
                height={220}
                style={{
                  border: `1px solid ${COLOR.border}`,
                  objectFit: "cover",
                  display: "flex",
                  marginRight: "40px",
                }}
                alt=""
              />
            ) : (
              <div
                style={{
                  width: "220px",
                  height: "220px",
                  background: COLOR.bgElevated,
                  border: `1px solid ${COLOR.border}`,
                  marginRight: "40px",
                  display: "flex",
                }}
              />
            )}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                flex: 1,
              }}
            >
              <div
                style={{
                  fontSize: "72px",
                  fontWeight: 700,
                  color: COLOR.textPrimary,
                  lineHeight: 1.05,
                  letterSpacing: "-0.02em",
                  display: "flex",
                }}
              >
                {nowPlaying.title}
              </div>
              <div
                style={{
                  fontSize: "40px",
                  fontWeight: 400,
                  color: COLOR.textSecondary,
                  lineHeight: 1.3,
                  marginTop: "12px",
                  display: "flex",
                }}
              >
                {nowPlaying.artist}
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* Fallback: brand-only editorial layout when Convex is
           unreachable or every station is null. */
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <div
            style={{
              fontSize: "84px",
              fontWeight: 700,
              lineHeight: 1.05,
              color: COLOR.textPrimary,
              letterSpacing: "-0.02em",
              display: "flex",
            }}
          >
            What&apos;s playing now.
          </div>
          <div
            style={{
              fontSize: "84px",
              fontWeight: 700,
              lineHeight: 1.05,
              color: COLOR.accentCta,
              letterSpacing: "-0.02em",
              marginTop: "8px",
              display: "flex",
            }}
          >
            Where they&apos;re playing next.
          </div>
        </div>
      )}

      {/* Bottom: tagline / closer */}
      {nowPlaying !== null && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "12px",
            fontSize: "20px",
            fontWeight: 400,
            color: COLOR.textSecondary,
            paddingTop: "20px",
            borderTop: `1px solid ${COLOR.border}`,
          }}
        >
          <span style={{ color: COLOR.textPrimary, fontWeight: 700 }}>
            What&apos;s playing now.
          </span>
          <span>Where they&apos;re playing next.</span>
        </div>
      )}
    </div>,
    {
      width: 1200,
      height: 630,
      fonts: fonts.length > 0 ? fonts : undefined,
      headers: {
        // 60s cache at the edge keeps the OG "live" without hammering
        // Convex on every social-share unfurl. Most platforms cache OG
        // for hours anyway; this is just our generation-side limit.
        "Cache-Control": "public, max-age=60, s-maxage=60, stale-while-revalidate=120",
      },
    },
  );
}
