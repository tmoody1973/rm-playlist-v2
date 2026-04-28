import { fetchQuery } from "convex/nextjs";
import { api } from "@rm/convex/api";
import { WidgetsClient } from "./WidgetsClient";

const WIDGET_CDN_BASE_DEFAULT = "https://rm-playlist-v2-embed.pages.dev/v1";

function pickWidgetCdnBase(): string {
  const override = process.env.RM_WIDGET_CDN_BASE;
  if (override && override.startsWith("https://")) return override;
  return WIDGET_CDN_BASE_DEFAULT;
}

export default async function WidgetsPage() {
  const stations = await fetchQuery(api.stations.list, {});
  const widgetCdnBase = pickWidgetCdnBase();

  return (
    <main className="flex flex-1 flex-col gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1
          style={{ fontFamily: "var(--font-display)" }}
          className="text-xl font-semibold tracking-tight"
        >
          Widgets
        </h1>
        <p className="text-sm text-text-secondary">
          Pick a widget variant and station, copy the embed code into any page on the web.
        </p>
      </header>

      <WidgetsClient stations={stations} widgetCdnBase={widgetCdnBase} />
    </main>
  );
}
