import type { ImageConfig } from "@/lib/blocks";

export function ImageBlock({ config }: { config: ImageConfig }) {
  const img = (
    // Arbitrary external URLs — plain <img> (next/image remote config is later).
    <img
      src={config.url}
      alt={config.alt ?? ""}
      className="w-full"
      style={{ borderRadius: "var(--rm-radius)" }}
    />
  );

  return (
    <section className="px-6 py-10">
      <figure className="mx-auto flex max-w-2xl flex-col gap-2">
        {config.href !== undefined ? <a href={config.href}>{img}</a> : img}
        {config.caption !== undefined && (
          <figcaption className="text-sm opacity-70">{config.caption}</figcaption>
        )}
      </figure>
    </section>
  );
}
