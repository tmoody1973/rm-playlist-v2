"use client";

import { BLOCK_TYPE_LABELS } from "@/lib/blockDefaults";
import { parseBlock, type RawBlock, type RenderableBlock } from "@/lib/blocks";
import { tokensToCssVars, type ThemeTokens } from "@/lib/theme";
import { Cta } from "./blocks/Cta";
import { FundraiserProgress } from "./blocks/FundraiserProgress";
import { Hero } from "./blocks/Hero";
import { ImageBlock } from "./blocks/ImageBlock";
import { LiveDataPlaceholder } from "./blocks/LiveDataPlaceholder";
import { RichText } from "./blocks/RichText";

/**
 * Client-side live preview for the editor. Renders content blocks exactly as
 * the public page does (reusing the presentational components), and shows
 * live-data blocks as labeled placeholders — those fetch server-side on the
 * real page, so the preview just marks their position.
 */
function previewBlock(block: RenderableBlock) {
  switch (block.type) {
    case "hero":
      return <Hero key={block.id} config={block.config} />;
    case "rich-text":
      return <RichText key={block.id} config={block.config} />;
    case "image":
      return <ImageBlock key={block.id} config={block.config} />;
    case "cta":
      return <Cta key={block.id} config={block.config} />;
    case "fundraiser-progress":
      return <FundraiserProgress key={block.id} config={block.config} />;
    default:
      return (
        <LiveDataPlaceholder
          key={block.id}
          label={`${BLOCK_TYPE_LABELS[block.type] ?? block.type} (live on published page)`}
        />
      );
  }
}

export function PreviewRenderer({ blocks, tokens }: { blocks: RawBlock[]; tokens: ThemeTokens }) {
  const parsed = blocks.map(parseBlock).filter((block): block is RenderableBlock => block !== null);

  return (
    <div
      style={{
        ...tokensToCssVars(tokens),
        background: "var(--rm-color-bg)",
        color: "var(--rm-color-text)",
        fontFamily: "var(--rm-font)",
      }}
    >
      {parsed.length === 0 ? (
        <p className="p-6 text-sm opacity-60">No renderable blocks yet.</p>
      ) : (
        parsed.map(previewBlock)
      )}
    </div>
  );
}
