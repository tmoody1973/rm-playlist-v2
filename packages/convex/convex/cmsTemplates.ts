/**
 * Preset block stacks for the Station Microsites CMS (design doc 005).
 *
 * A new page is seeded from the template for its `kind`; staff then edit the
 * stack in the admin builder. Shared by `pages.create` (admin write path) and
 * `seed:cmsStationHomeDemo` so there's one source of truth for "what a fresh
 * page looks like".
 *
 * Block `config` shapes match the renderer's Zod schemas in
 * apps/cms/lib/blocks.ts. IDs are positional and unique within a fresh page;
 * the editor (Phase 3b) generates IDs for blocks added later.
 */

export type TemplateBlock = { id: string; type: string; config: unknown };

export type StationLite = { slug: string; name: string; tagline?: string };

export const CMS_PAGE_KINDS = ["station-home", "event", "fundraiser"] as const;
export type CmsPageKind = (typeof CMS_PAGE_KINDS)[number];

export function isCmsPageKind(kind: string): kind is CmsPageKind {
  return (CMS_PAGE_KINDS as readonly string[]).includes(kind);
}

function stationHomeTemplate(station: StationLite): TemplateBlock[] {
  return [
    {
      id: "hero-1",
      type: "hero",
      config: {
        title: station.name,
        subtitle: station.tagline ?? "",
        cta: { label: "Listen live", href: "#" },
      },
    },
    {
      id: "richtext-1",
      type: "rich-text",
      config: { html: `<p>Welcome to ${station.name}.</p>` },
    },
    { id: "nowplaying-1", type: "now-playing", config: {} },
    { id: "playlist-1", type: "playlist", config: { limit: 8 } },
    { id: "events-1", type: "upcoming-events", config: { limit: 4 } },
    { id: "touring-1", type: "touring", config: { limit: 4 } },
    {
      id: "cta-1",
      type: "cta",
      config: { buttons: [{ label: `About ${station.name}`, href: "#" }] },
    },
  ];
}

function eventTemplate(station: StationLite): TemplateBlock[] {
  return [
    {
      id: "hero-1",
      type: "hero",
      config: {
        title: "Event title",
        subtitle: station.name,
        cta: { label: "Get tickets", href: "#" },
      },
    },
    { id: "richtext-1", type: "rich-text", config: { html: "<p>Event details.</p>" } },
    {
      id: "cta-1",
      type: "cta",
      config: { buttons: [{ label: "Get tickets", href: "#" }] },
    },
    { id: "touring-1", type: "touring", config: { limit: 3 } },
  ];
}

function fundraiserTemplate(station: StationLite): TemplateBlock[] {
  return [
    {
      id: "hero-1",
      type: "hero",
      config: {
        title: "Support " + station.name,
        subtitle: station.tagline ?? "",
        cta: { label: "Donate", href: "#" },
      },
    },
    {
      id: "fundraiser-1",
      type: "fundraiser-progress",
      config: { goal: 0, raised: 0, donateHref: "#" },
    },
    { id: "richtext-1", type: "rich-text", config: { html: "<p>Why your support matters.</p>" } },
    {
      id: "cta-1",
      type: "cta",
      config: { buttons: [{ label: "Donate", href: "#" }] },
    },
  ];
}

export function buildTemplate(kind: CmsPageKind, station: StationLite): TemplateBlock[] {
  switch (kind) {
    case "station-home":
      return stationHomeTemplate(station);
    case "event":
      return eventTemplate(station);
    case "fundraiser":
      return fundraiserTemplate(station);
  }
}
