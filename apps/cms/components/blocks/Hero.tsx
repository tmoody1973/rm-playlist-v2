import type { HeroConfig } from "@/lib/blocks";

export function Hero({ config }: { config: HeroConfig }) {
  const hasBg = config.backgroundImageUrl !== undefined;
  return (
    <section
      className="relative px-6 py-20 sm:py-28"
      style={{
        background: hasBg
          ? `linear-gradient(rgba(0,0,0,0.45), rgba(0,0,0,0.45)), url(${config.backgroundImageUrl}) center/cover`
          : "var(--rm-color-card)",
        color: hasBg ? "#fff" : "var(--rm-color-text)",
      }}
    >
      <div className="mx-auto flex max-w-3xl flex-col items-center gap-5 text-center">
        <h1 className="text-5xl font-bold tracking-tight sm:text-6xl">{config.title}</h1>
        {config.subtitle !== undefined && (
          <p className="text-lg opacity-80 sm:text-xl">{config.subtitle}</p>
        )}
        {config.cta !== undefined && (
          <a
            href={config.cta.href}
            className="mt-2 inline-flex items-center px-6 py-3 text-sm font-semibold uppercase tracking-wide"
            style={{
              background: "var(--rm-color-accent)",
              color: "#fff",
              borderRadius: "var(--rm-radius)",
            }}
          >
            {config.cta.label}
          </a>
        )}
      </div>
    </section>
  );
}
