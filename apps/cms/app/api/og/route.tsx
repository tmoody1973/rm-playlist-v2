import { ImageResponse } from "next/og";
import { ConvexHttpClient } from "convex/browser";
import { api } from "@rm/convex/api";
import { formatUsd } from "@/lib/format";

/**
 * Dynamic OG image for a station microsite page. Mirrors the next/og pattern in
 * apps/web/app/api/og/route.tsx, but renders a CMS page's title on its own
 * resolved theme colors (so the share card matches the page), plus fundraiser
 * progress when the page has a fundraiser-progress block.
 *
 * Reads the same getPublishedPage the page itself uses → preview always matches.
 * Falls back to a brand-only card when the station/page is missing or Convex is
 * unreachable. Edge runtime, cached 5m (OG consumers cache far longer anyway).
 */
export const runtime = "edge";

const BRAND = {
  bg: "#0e0f11",
  accent: "#e84f2f",
  text: "#faf7f2",
};

type Tokens = { colorBg: string; colorAccent: string; colorText: string };

type Block = { type: string; config: unknown };

async function loadInter(): Promise<ArrayBuffer | null> {
  try {
    const res = await fetch(
      "https://github.com/rsms/inter/raw/v3.19/docs/font-files/Inter-SemiBold.otf",
    );
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

function fundraiserFrom(blocks: Block[]): { pct: number; raised: number; goal: number } | null {
  const block = blocks.find((b) => b.type === "fundraiser-progress");
  if (block === undefined) return null;
  const c = (block.config ?? {}) as { goal?: unknown; raised?: unknown };
  const goal = typeof c.goal === "number" ? c.goal : 0;
  const raised = typeof c.raised === "number" ? c.raised : 0;
  const pct = goal > 0 ? Math.min(100, Math.max(0, Math.round((raised / goal) * 100))) : 0;
  return { pct, raised, goal };
}

export async function GET(request: Request) {
  const station = new URL(request.url).searchParams.get("station") ?? "";

  let title = "Radio Milwaukee";
  let stationName = "Radio Milwaukee";
  let tokens: Tokens = { colorBg: BRAND.bg, colorAccent: BRAND.accent, colorText: BRAND.text };
  let fundraiser: { pct: number; raised: number; goal: number } | null = null;

  const url = process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
  if (url && station.length > 0) {
    try {
      const client = new ConvexHttpClient(url);
      const data = await client.query(api.pages.getPublishedPage, {
        stationSlug: station,
        kind: "station-home",
        slug: "",
      });
      if (data !== null) {
        title = data.page.title;
        stationName = data.station.name;
        tokens = {
          colorBg: data.tokens.colorBg,
          colorAccent: data.tokens.colorAccent,
          colorText: data.tokens.colorText,
        };
        fundraiser = fundraiserFrom(data.page.blocks as Block[]);
      }
    } catch {
      // brand-only fallback below
    }
  }

  const inter = await loadInter();
  const fonts =
    inter !== null
      ? [{ name: "Inter", data: inter, weight: 600 as const, style: "normal" as const }]
      : [];

  return new ImageResponse(
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        width: "100%",
        height: "100%",
        background: tokens.colorBg,
        color: tokens.colorText,
        padding: "64px 72px",
        fontFamily: inter !== null ? "Inter, sans-serif" : "sans-serif",
      }}
    >
      <div
        style={{
          display: "flex",
          fontSize: "22px",
          letterSpacing: "0.12em",
          textTransform: "uppercase",
          color: tokens.colorAccent,
          fontWeight: 600,
        }}
      >
        {stationName}
      </div>

      <div style={{ display: "flex", fontSize: "76px", fontWeight: 600, lineHeight: 1.05 }}>
        {title}
      </div>

      {fundraiser !== null ? (
        <div style={{ display: "flex", flexDirection: "column", gap: "16px", width: "100%" }}>
          <div
            style={{
              display: "flex",
              width: "100%",
              height: "20px",
              background: "rgba(255,255,255,0.16)",
              borderRadius: "9999px",
            }}
          >
            <div
              style={{
                display: "flex",
                width: `${fundraiser.pct}%`,
                height: "100%",
                background: tokens.colorAccent,
                borderRadius: "9999px",
              }}
            />
          </div>
          <div style={{ display: "flex", fontSize: "28px" }}>
            {formatUsd(fundraiser.raised)} raised of {formatUsd(fundraiser.goal)} goal ·{" "}
            {fundraiser.pct}%
          </div>
        </div>
      ) : (
        <div style={{ display: "flex", fontSize: "24px", opacity: 0.7 }}>radiomilwaukee.org</div>
      )}
    </div>,
    { width: 1200, height: 630, fonts },
  );
}
