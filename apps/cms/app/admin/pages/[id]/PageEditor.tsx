"use client";

import { api } from "@rm/convex/api";
import type { Id } from "@rm/convex/values";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { PreviewRenderer } from "@/components/PreviewRenderer";
import { BlockForm } from "@/components/editor/BlockForm";
import { ADDABLE_BLOCK_TYPES, BLOCK_TYPE_LABELS, defaultConfig } from "@/lib/blockDefaults";
import type { RawBlock } from "@/lib/blocks";

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type EditState = { title: string; blocks: RawBlock[] };

export function PageEditor({ pageId }: { pageId: Id<"pages"> }) {
  const page = useQuery(api.pages.getPageForEdit, { pageId });
  const updatePage = useMutation(api.pages.updatePage);
  const setStatus = useMutation(api.pages.setStatus);

  const [state, setState] = useState<EditState | null>(null);
  const [addType, setAddType] = useState<string>("hero");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  // Initialize local edit state once, when the page first loads. Later query
  // re-emits (e.g. after save) must not clobber in-progress edits.
  useEffect(() => {
    if (page !== undefined && page !== null && state === null) {
      setState({ title: page.title, blocks: page.blocks as RawBlock[] });
    }
  }, [page, state]);

  if (page === undefined) return <p className="text-sm text-neutral-500">Loading…</p>;
  if (page === null) return <p className="text-sm text-neutral-500">Page not found.</p>;
  if (state === null) return <p className="text-sm text-neutral-500">Loading…</p>;

  const blocks = state.blocks;
  const setBlocks = (next: RawBlock[]) => setState({ ...state, blocks: next });

  const updateConfig = (id: string, config: unknown) =>
    setBlocks(blocks.map((b) => (b.id === id ? { ...b, config } : b)));
  const removeBlock = (id: string) => setBlocks(blocks.filter((b) => b.id !== id));
  const moveBlock = (index: number, dir: -1 | 1) => {
    const target = index + dir;
    if (target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    [next[index], next[target]] = [next[target]!, next[index]!];
    setBlocks(next);
  };
  const addBlock = () =>
    setBlocks([
      ...blocks,
      { id: crypto.randomUUID(), type: addType, config: defaultConfig(addType) },
    ]);

  async function onSave() {
    setError(null);
    setSaving(true);
    try {
      await updatePage({ pageId, title: state!.title, blocks: state!.blocks });
      setSavedAt(Date.now());
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function togglePublish() {
    setError(null);
    try {
      await setStatus({
        pageId,
        status: page!.status === "published" ? "draft" : "published",
      });
    } catch (err) {
      setError(errMessage(err));
    }
  }

  const published = page.status === "published";

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-col gap-1">
          <Link href="/admin" className="text-sm text-neutral-500 underline">
            ← All pages
          </Link>
          <h1 className="text-xl font-bold tracking-tight">
            {page.stationSlug} · {page.kind}
            {page.slug ? `/${page.slug}` : ""}
          </h1>
        </div>
        <div className="flex items-center gap-3">
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
              published ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
            }`}
          >
            {page.status}
          </span>
          <button
            type="button"
            onClick={togglePublish}
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium"
          >
            {published ? "Unpublish" : "Publish"}
          </button>
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-md bg-neutral-900 px-4 py-1.5 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </header>
      {error !== null && <p className="text-sm text-red-600">{error}</p>}
      {savedAt !== null && error === null && <p className="text-sm text-green-700">Saved.</p>}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        {/* Editor */}
        <div className="flex flex-col gap-4">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-neutral-500">Page title</span>
            <input
              value={state.title}
              onChange={(e) => setState({ ...state, title: e.target.value })}
              className="rounded-md border border-neutral-300 px-3 py-2"
            />
          </label>

          <ul className="flex flex-col gap-3">
            {blocks.map((block, index) => (
              <li key={block.id} className="rounded-lg border border-neutral-200 p-4">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-semibold">
                    {BLOCK_TYPE_LABELS[block.type] ?? block.type}
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => moveBlock(index, -1)}
                      disabled={index === 0}
                      className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-40"
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      onClick={() => moveBlock(index, 1)}
                      disabled={index === blocks.length - 1}
                      className="rounded border border-neutral-300 px-2 py-1 text-xs disabled:opacity-40"
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      onClick={() => removeBlock(block.id)}
                      className="rounded border border-red-300 px-2 py-1 text-xs text-red-700"
                    >
                      Remove
                    </button>
                  </div>
                </div>
                <BlockForm
                  type={block.type}
                  config={block.config}
                  onChange={(config) => updateConfig(block.id, config)}
                />
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-2">
            <select
              value={addType}
              onChange={(e) => setAddType(e.target.value)}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm"
            >
              {ADDABLE_BLOCK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {BLOCK_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={addBlock}
              className="rounded-md border border-neutral-300 px-3 py-2 text-sm font-medium"
            >
              Add block
            </button>
          </div>
        </div>

        {/* Live preview */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
            Live preview
          </p>
          <div className="overflow-hidden rounded-lg border border-neutral-200">
            <PreviewRenderer blocks={blocks} tokens={page.tokens} />
          </div>
        </div>
      </div>
    </div>
  );
}
