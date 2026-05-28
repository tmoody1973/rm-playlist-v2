import { api } from "@rm/convex/api";
import { fetchQuery } from "convex/nextjs";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageRenderer } from "@/components/PageRenderer";
import { isCmsStation } from "@/lib/stations";

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

  return <PageRenderer blocks={data.page.blocks} tokens={data.tokens} stationSlug={station} />;
}
