import { parseBlock, type RawBlock, type RenderableBlock } from "@/lib/blocks";
import type { CmsStationSlug } from "@/lib/stations";
import { tokensToCssVars, type ThemeTokens } from "@/lib/theme";
import { Cta } from "./blocks/Cta";
import { FundraiserProgress } from "./blocks/FundraiserProgress";
import { Hero } from "./blocks/Hero";
import { ImageBlock } from "./blocks/ImageBlock";
import { NowPlaying } from "./blocks/NowPlaying";
import { Playlist } from "./blocks/Playlist";
import { RichText } from "./blocks/RichText";
import { Touring } from "./blocks/Touring";
import { UpcomingEvents } from "./blocks/UpcomingEvents";

function renderBlock(block: RenderableBlock, stationSlug: CmsStationSlug) {
  switch (block.type) {
    case "hero":
      return <Hero key={block.id} config={block.config} />;
    case "rich-text":
      return <RichText key={block.id} config={block.config} />;
    case "image":
      return <ImageBlock key={block.id} config={block.config} />;
    case "cta":
      return <Cta key={block.id} config={block.config} />;
    case "now-playing":
      return <NowPlaying key={block.id} stationSlug={stationSlug} />;
    case "playlist":
      return <Playlist key={block.id} stationSlug={stationSlug} limit={block.config.limit} />;
    case "upcoming-events":
      return (
        <UpcomingEvents key={block.id} limit={block.config.limit} region={block.config.region} />
      );
    case "touring":
      return <Touring key={block.id} limit={block.config.limit} />;
    case "fundraiser-progress":
      return <FundraiserProgress key={block.id} config={block.config} />;
    default:
      return null;
  }
}

/**
 * Renders a CMS page: applies the resolved theme as CSS variables on a single
 * wrapper, then renders the ordered block stack. Invalid/unknown blocks are
 * dropped by parseBlock. Server component — live-data blocks fetch their own
 * data (now-playing hydrates client-side for realtime).
 */
export function PageRenderer({
  blocks,
  tokens,
  stationSlug,
}: {
  blocks: RawBlock[];
  tokens: ThemeTokens;
  stationSlug: CmsStationSlug;
}) {
  const parsed = blocks.map(parseBlock).filter((block): block is RenderableBlock => block !== null);

  return (
    <main
      className="min-h-screen"
      style={{
        ...tokensToCssVars(tokens),
        background: "var(--rm-color-bg)",
        color: "var(--rm-color-text)",
        fontFamily: "var(--rm-font)",
      }}
    >
      {parsed.map((block) => renderBlock(block, stationSlug))}
    </main>
  );
}
