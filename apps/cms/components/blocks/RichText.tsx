import type { RichTextConfig } from "@/lib/blocks";
import { isEmptyDoc, renderRichTextDoc } from "@/lib/richtext";

/**
 * Renders a structured Tiptap/ProseMirror doc via the allowlist serializer
 * (lib/richtext.tsx). No raw HTML is ever emitted, so there's no XSS surface.
 */
export function RichText({ config }: { config: RichTextConfig }) {
  if (isEmptyDoc(config.doc)) return null;

  return (
    <section className="px-6 py-10">
      <div className="mx-auto flex max-w-2xl flex-col gap-4 text-base leading-relaxed [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:pl-4 [&_blockquote]:opacity-80 [&_h1]:text-3xl [&_h1]:font-bold [&_h2]:text-2xl [&_h2]:font-semibold [&_h3]:text-xl [&_h3]:font-semibold [&_ol]:list-decimal [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:pl-6">
        {renderRichTextDoc(config.doc)}
      </div>
    </section>
  );
}
