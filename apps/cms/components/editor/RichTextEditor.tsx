"use client";

import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function ToolbarButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={`rounded border px-2 py-1 text-xs font-medium ${
        active ? "border-neutral-900 bg-neutral-900 text-white" : "border-neutral-300"
      }`}
    >
      {label}
    </button>
  );
}

/**
 * Tiptap WYSIWYG for rich-text blocks. Emits the ProseMirror doc JSON via
 * onChange (editor.getJSON()); the renderer serializes that through an
 * allowlist (lib/richtext.tsx), so what's stored is data, never HTML.
 *
 * StarterKit v3 bundles bold/italic/underline/strike/code, headings, lists,
 * blockquote, and link — we configure link to not open on click in the editor.
 */
export function RichTextEditor({
  value,
  onChange,
}: {
  value: unknown;
  onChange: (doc: unknown) => void;
}) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: false },
      }),
    ],
    content: isPlainObject(value) ? value : undefined,
    onUpdate: ({ editor }) => onChange(editor.getJSON()),
    editorProps: {
      attributes: {
        class:
          "min-h-[120px] rounded-md border border-neutral-300 px-3 py-2 focus:outline-none focus:ring-1 focus:ring-neutral-400 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:text-lg [&_h3]:font-semibold [&_ul]:list-disc [&_ul]:pl-6 [&_ol]:list-decimal [&_ol]:pl-6 [&_a]:underline [&_blockquote]:border-l-4 [&_blockquote]:pl-3 [&_blockquote]:opacity-80",
      },
    },
  });

  const s = useEditorState({
    editor,
    selector: ({ editor }) => ({
      bold: editor?.isActive("bold") ?? false,
      italic: editor?.isActive("italic") ?? false,
      h2: editor?.isActive("heading", { level: 2 }) ?? false,
      h3: editor?.isActive("heading", { level: 3 }) ?? false,
      bullet: editor?.isActive("bulletList") ?? false,
      ordered: editor?.isActive("orderedList") ?? false,
      link: editor?.isActive("link") ?? false,
      quote: editor?.isActive("blockquote") ?? false,
    }),
  });

  if (editor === null) return null;

  function setLink() {
    const prev =
      typeof editor!.getAttributes("link").href === "string"
        ? (editor!.getAttributes("link").href as string)
        : "";
    const url = window.prompt("Link URL (leave empty to remove)", prev);
    if (url === null) return;
    if (url.trim().length === 0) {
      editor!.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor!.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        <ToolbarButton
          active={s?.bold ?? false}
          label="B"
          onClick={() => editor.chain().focus().toggleBold().run()}
        />
        <ToolbarButton
          active={s?.italic ?? false}
          label="I"
          onClick={() => editor.chain().focus().toggleItalic().run()}
        />
        <ToolbarButton
          active={s?.h2 ?? false}
          label="H2"
          onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}
        />
        <ToolbarButton
          active={s?.h3 ?? false}
          label="H3"
          onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}
        />
        <ToolbarButton
          active={s?.bullet ?? false}
          label="• List"
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        />
        <ToolbarButton
          active={s?.ordered ?? false}
          label="1. List"
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        />
        <ToolbarButton
          active={s?.quote ?? false}
          label="❝"
          onClick={() => editor.chain().focus().toggleBlockquote().run()}
        />
        <ToolbarButton active={s?.link ?? false} label="Link" onClick={setLink} />
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}
