import type { Metadata } from "next";
import { buildPublicMetadata, PublicPage } from "@/lib/publicPage";

type Params = { params: Promise<{ station: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { station } = await params;
  return buildPublicMetadata({ station, kind: "station-home", slug: "" });
}

/**
 * Public station hub. Server-rendered from a published `station-home` page.
 * Unknown station, no page, or a draft → 404 (drafts stay private).
 */
export default async function StationHome({ params }: Params) {
  const { station } = await params;
  return <PublicPage station={station} kind="station-home" slug="" />;
}
