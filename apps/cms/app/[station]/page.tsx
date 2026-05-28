import { api } from "@rm/convex/api";
import { fetchQuery } from "convex/nextjs";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageRenderer } from "@/components/PageRenderer";

/** Stations with public microsites. 414music has none (design doc 005). */
const CMS_STATIONS = ["hyfin", "88nine", "rhythmlab"] as const;

function isCmsStation(slug: string): boolean {
  return (CMS_STATIONS as readonly string[]).includes(slug);
}

type Params = { params: Promise<{ station: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { station } = await params;
  if (!isCmsStation(station)) return {};

  const data = await fetchQuery(api.pages.getPublishedPage, {
    stationSlug: station,
    kind: "station-home",
    slug: "",
  });
  if (data === null) return {};

  return {
    title: data.page.seo?.title ?? data.station.name,
    description: data.page.seo?.description ?? data.station.tagline ?? undefined,
  };
}

/**
 * Public station hub. Server-rendered from a published `station-home` page.
 * Unknown station, no page, or a draft → 404 (drafts stay private).
 */
export default async function StationHome({ params }: Params) {
  const { station } = await params;
  if (!isCmsStation(station)) notFound();

  const data = await fetchQuery(api.pages.getPublishedPage, {
    stationSlug: station,
    kind: "station-home",
    slug: "",
  });
  if (data === null) notFound();

  return <PageRenderer blocks={data.page.blocks} tokens={data.tokens} />;
}
