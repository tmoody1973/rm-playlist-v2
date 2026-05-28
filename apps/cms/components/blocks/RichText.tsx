import type { RichTextConfig } from "@/lib/blocks";

/**
 * Renders plain-text rich-text as escaped paragraphs. React escapes the text,
 * so there's no XSS surface. Paragraphs split on blank lines.
 *
 * Phase 3b-2 upgrades this to a structured Tiptap/ProseMirror doc rendered via
 * an allowlist serializer (bold/italic/links/lists), still without raw HTML.
 */
export function RichText({ config }: { config: RichTextConfig }) {
  const paragraphs = config.text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);

  if (paragraphs.length === 0) return null;

  return (
    <section className="px-6 py-10">
      <div className="mx-auto flex max-w-2xl flex-col gap-4 text-base leading-relaxed">
        {paragraphs.map((paragraph, i) => (
          <p key={i}>{paragraph}</p>
        ))}
      </div>
    </section>
  );
}
