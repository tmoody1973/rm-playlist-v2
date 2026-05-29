import { api } from "@rm/convex/api";
import { fetchQuery } from "convex/nextjs";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PageRenderer } from "@/components/PageRenderer";
import { UploadedFontFaces } from "@/components/UploadedFontFaces";
import { type CmsStationSlug, isCmsStation } from "@/lib/stations";

/**
 * Shared render + metadata logic for every public microsite page — the station
 * hub (`station-home`, slug "") and the event/fundraiser pages. Each App Router
 * route file is a thin wrapper that supplies its kind + slug; this keeps the
 * fetch / 404 / theme / SEO / OG wiring in one place.
 */
type PublicPageArgs = { station: string; kind: string; slug: string };

/** Build the dynamic OG image URL, carrying kind+slug for non-hub pages. */
function ogImageUrl({ station, kind, slug }: PublicPageArgs): string {
  const params = new URLSearchParams({ station });
  if (kind !== "station-home") params.set("kind", kind);
  if (slug.length > 0) params.set("slug", slug);
  return `/api/og?${params.toString()}`;
}

/**
 * Metadata for a public page: title/description from the page's SEO (falling
 * back to station name/tagline) + an og:image that's the staff override or the
 * dynamic OG card. Returns `{}` for non-CMS stations / missing pages so Next
 * emits nothing special (the route itself 404s in the body).
 */
export async function buildPublicMetadata({
  station,
  kind,
  slug,
}: PublicPageArgs): Promise<Metadata> {
  if (!isCmsStation(station)) return {};

  const data = await fetchQuery(api.pages.getPublishedPage, {
    stationSlug: station,
    kind,
    slug,
  });
  if (data === null) return {};

  // Title fallback: the station hub uses the station name (unchanged from the
  // original behavior, regardless of the hub page's editable title); event and
  // fundraiser pages use their own page title — keeping <title>, og:title, and
  // the OG card consistent for those.
  const fallbackTitle = kind === "station-home" ? data.station.name : data.page.title;
  const title = data.page.seo?.title ?? fallbackTitle;
  const description = data.page.seo?.description ?? data.station.tagline ?? undefined;
  const image = data.page.seo?.ogImage ?? ogImageUrl({ station, kind, slug });

  return {
    title,
    description,
    openGraph: { title, description, images: [{ url: image, width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

/**
 * Render a published public page, or 404. Unknown station, no page, or a draft
 * all become notFound() so drafts stay private.
 */
export async function PublicPage({ station, kind, slug }: PublicPageArgs) {
  if (!isCmsStation(station)) notFound();

  const data = await fetchQuery(api.pages.getPublishedPage, {
    stationSlug: station,
    kind,
    slug,
  });
  if (data === null) notFound();

  return (
    <>
      <UploadedFontFaces />
      <PageRenderer
        blocks={data.page.blocks}
        tokens={data.tokens}
        stationSlug={station as CmsStationSlug}
      />
    </>
  );
}
