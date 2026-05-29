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
import { applyOverrides, COLOR_TOKEN_FIELDS } from "@/lib/theme";
import type { ColorTokenKey, ThemeOverrides, ThemeTokens } from "@/lib/theme";

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type OverrideState = Record<ColorTokenKey, { on: boolean; value: string }>;

type SeoState = { title: string; description: string; ogImage: string };

type EditState = {
  title: string;
  blocks: RawBlock[];
  themeId: string | null;
  overrides: OverrideState;
  seo: SeoState;
};

function initOverrides(
  base: ThemeTokens,
  saved: Partial<Record<ColorTokenKey, string>> | null,
): OverrideState {
  const out = {} as OverrideState;
  for (const { key } of COLOR_TOKEN_FIELDS) {
    const savedValue = saved?.[key];
    out[key] = {
      on: typeof savedValue === "string" && savedValue.length > 0,
      value: savedValue ?? base[key],
    };
  }
  return out;
}

export function PageEditor({ pageId }: { pageId: Id<"pages"> }) {
  const page = useQuery(api.pages.getPageForEdit, { pageId });
  const themes = useQuery(
    api.themes.listForStation,
    page ? { stationSlug: page.stationSlug } : "skip",
  );
  const updatePage = useMutation(api.pages.updatePage);
  const setPageTheme = useMutation(api.pages.setPageTheme);
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
      setState({
        title: page.title,
        blocks: page.blocks as RawBlock[],
        themeId: page.themeId,
        overrides: initOverrides(page.tokens, page.themeOverrides),
        seo: {
          title: page.seo?.title ?? "",
          description: page.seo?.description ?? "",
          ogImage: page.seo?.ogImage ?? "",
        },
      });
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

  // Resolve the preview's base tokens: the picked theme, else the station
  // default, else whatever the server last resolved. Overrides layer on top —
  // mirrors the server cascade so the preview tracks edits live.
  const themeList = themes ?? [];
  const pickedTheme = state.themeId ? themeList.find((t) => t._id === state.themeId) : undefined;
  const stationDefault = themeList.find((t) => t.isStationDefault);
  const baseTokens: ThemeTokens = pickedTheme?.tokens ?? stationDefault?.tokens ?? page.tokens;
  const activeOverrides: ThemeOverrides = {};
  for (const { key } of COLOR_TOKEN_FIELDS) {
    const o = state.overrides[key];
    if (o.on && o.value.length > 0) activeOverrides[key] = o.value;
  }
  const previewTokens = applyOverrides(baseTokens, activeOverrides);

  const setOverride = (key: ColorTokenKey, patch: Partial<{ on: boolean; value: string }>) =>
    setState({
      ...state,
      overrides: { ...state.overrides, [key]: { ...state.overrides[key], ...patch } },
    });

  async function onSave() {
    setError(null);
    setSaving(true);
    try {
      await updatePage({
        pageId,
        title: state!.title,
        blocks: state!.blocks,
        // Empty fields are stripped server-side → page inherits station fallbacks.
        seo: {
          title: state!.seo.title,
          description: state!.seo.description,
          ogImage: state!.seo.ogImage,
        },
      });
      const overrides: ThemeOverrides = {};
      for (const { key } of COLOR_TOKEN_FIELDS) {
        const o = state!.overrides[key];
        if (o.on && o.value.length > 0) overrides[key] = o.value;
      }
      await setPageTheme({
        pageId,
        themeId: state!.themeId ? (state!.themeId as Id<"themes">) : undefined,
        overrides,
      });
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

          {/* Theme controls */}
          <fieldset className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4">
            <legend className="px-1 text-sm font-semibold">Theme</legend>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-neutral-500">Base theme</span>
              <select
                value={state.themeId ?? ""}
                onChange={(e) => setState({ ...state, themeId: e.target.value || null })}
                className="rounded-md border border-neutral-300 px-3 py-2"
              >
                <option value="">Inherit station default</option>
                {themeList.map((t) => (
                  <option key={t._id} value={t._id}>
                    {t.name}
                    {t.isStationDefault ? " (default)" : t.scope === "org" ? " (preset)" : ""}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex flex-col gap-2">
              <span className="text-xs font-medium uppercase tracking-wide text-neutral-500">
                Color overrides
              </span>
              {COLOR_TOKEN_FIELDS.map(({ key, label }) => {
                const o = state.overrides[key];
                return (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={o.on}
                      onChange={(e) => setOverride(key, { on: e.target.checked })}
                    />
                    <span className="w-24 text-neutral-600">{label}</span>
                    <input
                      type="color"
                      value={o.value}
                      disabled={!o.on}
                      onChange={(e) => setOverride(key, { value: e.target.value })}
                      className="h-7 w-9 cursor-pointer rounded border border-neutral-300 disabled:opacity-40"
                      aria-label={`${label} override`}
                    />
                    {!o.on && <span className="text-xs text-neutral-400">inherit</span>}
                  </label>
                );
              })}
            </div>
          </fieldset>

          {/* SEO / social share */}
          <fieldset className="flex flex-col gap-3 rounded-lg border border-neutral-200 p-4">
            <legend className="px-1 text-sm font-semibold">SEO &amp; sharing</legend>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-neutral-500">Title (falls back to station name)</span>
              <input
                value={state.seo.title}
                onChange={(e) =>
                  setState({ ...state, seo: { ...state.seo, title: e.target.value } })
                }
                placeholder={page.title}
                className="rounded-md border border-neutral-300 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-neutral-500">Description</span>
              <textarea
                value={state.seo.description}
                onChange={(e) =>
                  setState({ ...state, seo: { ...state.seo, description: e.target.value } })
                }
                rows={2}
                className="rounded-md border border-neutral-300 px-3 py-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-neutral-500">
                Share image URL (optional — overrides the auto-generated one)
              </span>
              <input
                value={state.seo.ogImage}
                onChange={(e) =>
                  setState({ ...state, seo: { ...state.seo, ogImage: e.target.value } })
                }
                placeholder="https://…"
                className="rounded-md border border-neutral-300 px-3 py-2"
              />
            </label>
          </fieldset>

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
            <PreviewRenderer blocks={blocks} tokens={previewTokens} />
          </div>
        </div>
      </div>
    </div>
  );
}
