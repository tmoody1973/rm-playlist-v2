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

  return <img src={src} alt={alt} style={style} loading="lazy" decoding="async" />;
}
