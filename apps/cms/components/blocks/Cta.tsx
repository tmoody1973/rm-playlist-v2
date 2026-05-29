import type { CtaConfig } from "@/lib/blocks";

export function Cta({ config }: { config: CtaConfig }) {
  return (
    <section className="px-6 py-10">
      <div className="mx-auto flex max-w-2xl flex-wrap items-center justify-center gap-3">
        {config.buttons.map((button, i) => {
          const secondary = button.variant === "secondary";
          return (
            <a
              key={`${button.href}-${i}`}
              href={button.href}
              className="inline-flex items-center px-5 py-2.5 text-sm font-semibold"
              style={{
                borderRadius: "var(--rm-radius)",
                background: secondary ? "transparent" : "var(--rm-color-accent)",
                color: secondary ? "var(--rm-color-text)" : "#fff",
                border: secondary ? "1px solid var(--rm-color-text)" : "none",
              }}
            >
              {button.label}
            </a>
          );
        })}
      </div>
    </section>
  );
}
