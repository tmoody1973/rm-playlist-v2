import { parseBlock, type RawBlock, type RenderableBlock } from "@/lib/blocks";
import { tokensToCssVars, type ThemeTokens } from "@/lib/theme";
import { Cta } from "./blocks/Cta";
import { Hero } from "./blocks/Hero";
import { ImageBlock } from "./blocks/ImageBlock";
import { LiveDataPlaceholder } from "./blocks/LiveDataPlaceholder";
import { RichText } from "./blocks/RichText";

function renderBlock(block: RenderableBlock) {
  switch (block.type) {
    case "hero":
      return <Hero key={block.id} config={block.config} />;
    case "rich-text":
      return <RichText key={block.id} config={block.config} />;
    case "image":
      return <ImageBlock key={block.id} config={block.config} />;
    case "cta":
      return <Cta key={block.id} config={block.config} />;
    default:
      return <LiveDataPlaceholder key={block.id} type={block.type} />;
  }
}

/**
 * Renders a CMS page: applies the resolved theme as CSS variables on a single
 * wrapper, then renders the ordered block stack. Invalid/unknown blocks are
 * dropped by parseBlock. Server component — no client JS for static pages.
 */
export function PageRenderer({ blocks, tokens }: { blocks: RawBlock[]; tokens: ThemeTokens }) {
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
      {parsed.map(renderBlock)}
    </main>
  );
}
