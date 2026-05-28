/** Block types staff can add in the editor, with human labels. */
export const BLOCK_TYPE_LABELS: Record<string, string> = {
  hero: "Hero",
  "rich-text": "Rich text",
  image: "Image",
  cta: "Call to action",
  "now-playing": "Now playing",
  playlist: "Playlist",
  "upcoming-events": "Upcoming events",
  touring: "Touring artists",
  "fundraiser-progress": "Fundraiser progress",
};

export const ADDABLE_BLOCK_TYPES = Object.keys(BLOCK_TYPE_LABELS);

/** Sensible starting config when a block is added. Matches the Zod schemas. */
export function defaultConfig(type: string): unknown {
  switch (type) {
    case "hero":
      return { title: "Heading" };
    case "rich-text":
      return { text: "" };
    case "image":
      return { url: "" };
    case "cta":
      return { buttons: [{ label: "Button", href: "#" }] };
    case "playlist":
      return { limit: 8 };
    case "upcoming-events":
      return { limit: 4 };
    case "touring":
      return { limit: 4 };
    case "fundraiser-progress":
      return { goal: 0, raised: 0, donateHref: "#" };
    default:
      return {};
  }
}
