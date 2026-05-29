import type { Metadata } from "next";
import { buildPublicMetadata, PublicPage } from "@/lib/publicPage";

type Params = { params: Promise<{ station: string; slug: string }> };

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { station, slug } = await params;
  return buildPublicMetadata({ station, kind: "fundraiser", slug });
}

/**
 * Public fundraiser page. Server-rendered from a published `fundraiser` page for
 * the station + slug. Unknown station, no page, or a draft → 404.
 */
export default async function FundraiserPage({ params }: Params) {
  const { station, slug } = await params;
  return <PublicPage station={station} kind="fundraiser" slug={slug} />;
}
