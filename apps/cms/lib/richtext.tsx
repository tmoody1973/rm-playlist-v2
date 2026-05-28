import type { ReactNode } from "react";

/**
 * Allowlist serializer: ProseMirror/Tiptap doc JSON → React elements.
 *
 * This is the XSS-safety boundary for rich text. It NEVER emits raw HTML
 * (no dangerouslySetInnerHTML). Only the node/mark types below are rendered;
 * anything else is ignored (children still rendered defensively for unknown
 * block nodes). Link hrefs are scheme-checked so `javascript:` / `data:` can't
 * slip through. Because rendering is safe by construction, the stored doc does
 * not need server-side sanitization.
 */

type PMMark = { type?: string; attrs?: Record<string, unknown> | null };
type PMNode = {
  type?: string;
  content?: PMNode[];
  text?: string;
  marks?: PMMark[];
  attrs?: Record<string, unknown> | null;
};

/** Allow relative, anchor, http(s) and mailto links only. */
function safeHref(href: unknown): string | null {
  if (typeof href !== "string") return null;
  const value = href.trim();
  if (value.length === 0) return null;
  if (value.startsWith("/") || value.startsWith("#")) return value;
  try {
    const url = new URL(value);
    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") {
      return value;
    }
  } catch {
    return null;
  }
  return null;
}

function applyMarks(text: string, marks: PMMark[] | undefined, key: string): ReactNode {
  if (marks === undefined || marks.length === 0) return text;
  return marks.reduce<ReactNode>((acc, mark, i) => {
    switch (mark.type) {
      case "bold":
        return <strong key={`${key}-b${i}`}>{acc}</strong>;
      case "italic":
        return <em key={`${key}-i${i}`}>{acc}</em>;
      case "underline":
        return <u key={`${key}-u${i}`}>{acc}</u>;
      case "strike":
        return <s key={`${key}-s${i}`}>{acc}</s>;
      case "code":
        return <code key={`${key}-c${i}`}>{acc}</code>;
      case "link": {
        const href = safeHref(mark.attrs?.href);
        return href === null ? (
          acc
        ) : (
          <a key={`${key}-l${i}`} href={href} target="_blank" rel="noreferrer noopener">
            {acc}
          </a>
        );
      }
      default:
        return acc; // unknown mark: ignored, text preserved
    }
  }, text);
}

function renderNodes(nodes: PMNode[] | undefined, keyPrefix: string): ReactNode[] {
  if (nodes === undefined) return [];
  return nodes.map((node, i) => renderNode(node, `${keyPrefix}-${i}`));
}

function renderNode(node: PMNode, key: string): ReactNode {
  switch (node.type) {
    case "text":
      return applyMarks(node.text ?? "", node.marks, key);
    case "paragraph":
      return <p key={key}>{renderNodes(node.content, key)}</p>;
    case "heading": {
      const level = typeof node.attrs?.level === "number" ? node.attrs.level : 2;
      const children = renderNodes(node.content, key);
      if (level <= 1) return <h1 key={key}>{children}</h1>;
      if (level === 2) return <h2 key={key}>{children}</h2>;
      return <h3 key={key}>{children}</h3>;
    }
    case "bulletList":
      return <ul key={key}>{renderNodes(node.content, key)}</ul>;
    case "orderedList":
      return <ol key={key}>{renderNodes(node.content, key)}</ol>;
    case "listItem":
      return <li key={key}>{renderNodes(node.content, key)}</li>;
    case "blockquote":
      return <blockquote key={key}>{renderNodes(node.content, key)}</blockquote>;
    case "hardBreak":
      return <br key={key} />;
    default:
      // Unknown node: render its children defensively, drop the wrapper.
      return node.content === undefined ? null : (
        <span key={key}>{renderNodes(node.content, key)}</span>
      );
  }
}

/** True when the doc has no text content (so the block renders nothing). */
export function isEmptyDoc(doc: unknown): boolean {
  if (doc === null || typeof doc !== "object") return true;
  const text = JSON.stringify(doc).match(/"text":"([^"]*)"/g);
  return text === null || text.every((t) => t === '"text":""');
}

/** Render a doc to React nodes, or null if it isn't a valid doc. */
export function renderRichTextDoc(doc: unknown): ReactNode {
  if (doc === null || typeof doc !== "object") return null;
  const root = doc as PMNode;
  if (root.type !== "doc") return null;
  return <>{renderNodes(root.content, "rt")}</>;
}
