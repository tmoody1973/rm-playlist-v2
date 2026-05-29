"use client";

import { api } from "@rm/convex/api";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { CMS_STATIONS } from "@/lib/stations";

const KINDS = ["station-home", "event", "fundraiser"] as const;
type Kind = (typeof KINDS)[number];

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Public URL for a page by kind. station-home lives at /[station]; event and
 * fundraiser pages at /[station]/{events|fundraisers}/[slug]. Returns null for
 * kinds without a public route yet.
 */
function publicPath(stationSlug: string, kind: string, slug: string): string | null {
  if (kind === "station-home") return `/${stationSlug}`;
  if (kind === "event") return `/${stationSlug}/events/${slug}`;
  if (kind === "fundraiser") return `/${stationSlug}/fundraisers/${slug}`;
  return null;
}

/**
 * Phase 3a admin: create pages from templates, publish/unpublish, delete.
 * The block-stack editor (per-block config + live preview) lands in Phase 3b.
 * All writes are role-checked server-side; this UI only mirrors the rules.
 */
export function PageManager() {
  const pages = useQuery(api.pages.listPages);
  const me = useQuery(api.users.currentUser, {});
  const create = useMutation(api.pages.create);
  const setStatus = useMutation(api.pages.setStatus);
  const remove = useMutation(api.pages.remove);

  const [station, setStation] = useState<string>(CMS_STATIONS[0]);
  const [kind, setKind] = useState<Kind>("station-home");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isAdmin = me?.role === "admin";
  const needsSlug = kind !== "station-home";

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await create({
        stationSlug: station,
        kind,
        title: needsSlug ? title : undefined,
        slug: needsSlug ? slug : undefined,
      });
      setTitle("");
      setSlug("");
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function runAction(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errMessage(err));
    }
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="rounded-lg border border-neutral-200 p-5">
        <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-neutral-500">
          New page
        </h2>
        <form onSubmit={onCreate} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-neutral-500">Station</span>
            <select
              value={station}
              onChange={(e) => setStation(e.target.value)}
              className="rounded-md border border-neutral-300 px-3 py-2"
            >
              {CMS_STATIONS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-neutral-500">Kind</span>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as Kind)}
              className="rounded-md border border-neutral-300 px-3 py-2"
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {k}
                </option>
              ))}
            </select>
          </label>
          {needsSlug && (
            <>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-neutral-500">Title</span>
                <input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Summerfest 2026"
                  className="rounded-md border border-neutral-300 px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-neutral-500">Slug</span>
                <input
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="summerfest-2026"
                  className="rounded-md border border-neutral-300 px-3 py-2"
                />
              </label>
            </>
          )}
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          >
            {busy ? "Creating…" : "Create"}
          </button>
        </form>
        {error !== null && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Pages</h2>
        {pages === undefined ? (
          <p className="text-sm text-neutral-500">Loading…</p>
        ) : pages.length === 0 ? (
          <p className="text-sm text-neutral-500">No pages yet. Create one above.</p>
        ) : (
          <ul className="flex flex-col divide-y divide-neutral-200 rounded-lg border border-neutral-200">
            {pages.map((page) => {
              const published = page.status === "published";
              const viewHref = publicPath(page.stationSlug, page.kind, page.slug);
              const canView = published && viewHref !== null;
              return (
                <li key={page._id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      {page.title}{" "}
                      <span className="text-xs text-neutral-400">
                        · {page.stationSlug} · {page.kind}
                        {page.slug ? `/${page.slug}` : ""}
                      </span>
                    </p>
                  </div>
                  <span
                    className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                      published ? "bg-green-100 text-green-800" : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {page.status}
                  </span>
                  <a
                    href={`/admin/pages/${page._id}`}
                    className="text-sm text-neutral-600 underline"
                  >
                    Edit
                  </a>
                  {canView && viewHref !== null && (
                    <a
                      href={viewHref}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm text-neutral-600 underline"
                    >
                      View
                    </a>
                  )}
                  <button
                    type="button"
                    onClick={() =>
                      runAction(() =>
                        setStatus({
                          pageId: page._id,
                          status: published ? "draft" : "published",
                        }),
                      )
                    }
                    className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium"
                  >
                    {published ? "Unpublish" : "Publish"}
                  </button>
                  {isAdmin && (
                    <button
                      type="button"
                      onClick={() => {
                        if (confirm(`Delete "${page.title}"? This cannot be undone.`)) {
                          void runAction(() => remove({ pageId: page._id }));
                        }
                      }}
                      className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700"
                    >
                      Delete
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
