import type { RichTextConfig } from "@/lib/blocks";

/**
 * Renders Tiptap HTML. The HTML is trusted in Phase 1 (only the seed writes
 * pages). When the admin builder lands in Phase 3, it MUST sanitize on write
 * (server-side allowlist) before this is fed user-authored content.
 */
export function RichText({ config }: { config: RichTextConfig }) {
  return (
    <section className="px-6 py-10">
      <div
        className="mx-auto max-w-2xl text-base leading-relaxed [&_a]:underline [&_p]:mb-4"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: trusted seed HTML; Phase 3 sanitizes on write.
        dangerouslySetInnerHTML={{ __html: config.html }}
      />
    </section>
  );
}
