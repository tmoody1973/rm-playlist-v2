import { api } from "@rm/convex/api";
import { fetchQuery } from "convex/nextjs";
import { RM_ORG_SLUG } from "@/lib/stations";

/**
 * Server component that emits an @font-face rule for every admin-uploaded font,
 * so custom faces render on public pages and in the admin previews/picker. Reads
 * the public `fonts.listForRender` (no Clerk identity on public pages). Mounted
 * only where fonts render — not the root layout — to avoid a Convex fetch on
 * every route. The woff2/ttf/otf file is loaded lazily by the browser (only when
 * text actually uses the family), so declaring all faces is cheap.
 */
const CSS_FORMAT: Record<"woff2" | "ttf" | "otf", string> = {
  woff2: "woff2",
  ttf: "truetype",
  otf: "opentype",
};

export async function UploadedFontFaces() {
  const fonts = await fetchQuery(api.fonts.listForRender, { orgSlug: RM_ORG_SLUG });
  if (fonts.length === 0) return null;

  const css = fonts
    .map(
      (f) =>
        `@font-face{font-family:"${f.family}";src:url("${f.url}") format("${CSS_FORMAT[f.format]}");font-display:swap;}`,
    )
    .join("");

  // @font-face CSS built server-side from our own storage URLs + a fixed format
  // allowlist (no user-controlled markup), so dangerouslySetInnerHTML is safe.
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}
