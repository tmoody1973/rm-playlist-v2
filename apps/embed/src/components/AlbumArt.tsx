import { h } from "preact";

interface AlbumArtProps {
  readonly src: string | null;
  readonly alt: string;
  readonly size: number;
}

/**
 * Album art with graceful-absence fallback. When enrichment hasn't resolved
 * the track yet (`artworkUrl` null), we render a neutral placeholder tile
 * sized identically to the loaded-art case — the row never reflows.
 *
 * Square per DESIGN.md § Layout (radius 0, respects album-art convention).
 */
export function AlbumArt({ src, alt, size }: AlbumArtProps) {
  const style: h.JSX.CSSProperties = {
    width: `${size}px`,
    height: `${size}px`,
    background: "var(--rmke-bg-elevated)",
    border: "1px solid var(--rmke-border)",
    flexShrink: 0,
    objectFit: "cover",
    display: "block",
  };

  if (src === null) {
    return <div style={style} aria-label={alt} role="img" />;
  }

  return (
    <img
      src={materializeArtworkUrl(src, size)}
      alt={alt}
      style={style}
      loading="lazy"
      decoding="async"
    />
  );
}

/**
 * Apple Music catalog API returns artwork as a template URL with `{w}` and
 * `{h}` placeholders that callers must substitute at render time. Enrichment
 * stores the template verbatim so each widget can request the size it needs.
 * Other sources (MusicBrainz, Spotify) return fully-materialized URLs that
 * don't contain the placeholders, so the regex is a no-op for them.
 *
 * Uses 2x the display size for crisp rendering on retina screens.
 */
function materializeArtworkUrl(url: string, size: number): string {
  const pixelSize = String(size * 2);
  return url
    .replace(/\{w\}|%7Bw%7D/g, pixelSize)
    .replace(/\{h\}|%7Bh%7D/g, pixelSize);
}
