import { h } from "preact";

interface SkeletonProps {
  readonly width?: string;
  readonly height?: string;
  readonly radius?: string;
}

/**
 * Neutral loading shimmer, used during the brief window between mount and
 * the first Convex subscription push. Size and radius are tokens-first so
 * each variant can slot its own dimensions without diverging visually.
 */
export function Skeleton({ width = "100%", height = "1em", radius }: SkeletonProps) {
  return (
    <div
      aria-hidden="true"
      style={{
        width,
        height,
        borderRadius: radius ?? "var(--rmke-radius-sm)",
        background: "var(--rmke-bg-elevated)",
        opacity: 0.6,
      }}
    />
  );
}
