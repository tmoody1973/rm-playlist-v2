import { api } from "@rm/convex/api";
import { fetchQuery } from "convex/nextjs";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageRenderer } from "@/components/PageRenderer";
import { UploadedFontFaces } from "@/components/UploadedFontFaces";
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

  const title = data.page.seo?.title ?? data.station.name;
  const description = data.page.seo?.description ?? data.station.tagline ?? undefined;
  // Staff-supplied share image wins; otherwise the dynamic on-theme OG card.
  const ogImage = data.page.seo?.ogImage ?? `/api/og?station=${station}`;

  return {
    title,
    description,
    openGraph: { title, description, images: [{ url: ogImage, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: [ogImage] },
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

  return (
    <>
      <UploadedFontFaces />
      <PageRenderer blocks={data.page.blocks} tokens={data.tokens} stationSlug={station} />
    </>
  );
}
