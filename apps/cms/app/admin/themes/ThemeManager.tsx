"use client";

import { api } from "@rm/convex/api";
import type { Id } from "@rm/convex/values";
import { useMutation, useQuery } from "convex/react";
import { useState } from "react";
import { ThemeTokenForm } from "@/components/editor/ThemeTokenForm";
import { COLOR_TOKEN_FIELDS } from "@/lib/theme";
import type { ThemeTokens } from "@/lib/theme";
import { CMS_STATIONS } from "@/lib/stations";

function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

const DEFAULT_TOKENS: ThemeTokens = {
  colorPrimary: "#0e0f11",
  colorBg: "#ffffff",
  colorCard: "#f4f5f7",
  colorAccent: "#e84f2f",
  colorText: "#16191d",
  font: '"General Sans", ui-sans-serif, system-ui, sans-serif',
  radius: "12px",
};

type ThemeRow = {
  _id: Id<"themes">;
  name: string;
  tokens: ThemeTokens;
  isStationDefault: boolean;
  stationSlug: string | null;
  stationName: string;
};

function Swatches({ tokens }: { tokens: ThemeTokens }) {
  return (
    <div className="flex items-center gap-1">
      {COLOR_TOKEN_FIELDS.map(({ key, label }) => (
        <span
          key={key}
          title={`${label}: ${tokens[key]}`}
          className="h-5 w-5 rounded-full border border-neutral-300"
          style={{ backgroundColor: tokens[key] }}
        />
      ))}
    </div>
  );
}

export function ThemeManager() {
  const themes = useQuery(api.themes.listAll, {});
  const me = useQuery(api.users.currentUser, {});
  const createTheme = useMutation(api.themes.createTheme);
  const updateTheme = useMutation(api.themes.updateTheme);
  const setStationDefault = useMutation(api.themes.setStationDefault);
  const removeTheme = useMutation(api.themes.removeTheme);

  const isAdmin = me?.role === "admin";

  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<Id<"themes"> | null>(null);
  const [editName, setEditName] = useState("");
  const [editTokens, setEditTokens] = useState<ThemeTokens>(DEFAULT_TOKENS);

  // Create form
  const [newName, setNewName] = useState("");
  const [newScope, setNewScope] = useState<string>(CMS_STATIONS[0]);
  const [newTokens, setNewTokens] = useState<ThemeTokens>(DEFAULT_TOKENS);
  const [creating, setCreating] = useState(false);

  async function runAction(fn: () => Promise<unknown>) {
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(errMessage(err));
    }
  }

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setCreating(true);
    try {
      await createTheme({
        name: newName,
        stationSlug: newScope === "org" ? undefined : newScope,
        tokens: newTokens,
      });
      setNewName("");
      setNewTokens(DEFAULT_TOKENS);
    } catch (err) {
      setError(errMessage(err));
    } finally {
      setCreating(false);
    }
  }

  function startEdit(theme: ThemeRow) {
    setEditingId(theme._id);
    setEditName(theme.name);
    setEditTokens(theme.tokens);
  }

  async function onSaveEdit(themeId: Id<"themes">) {
    await runAction(async () => {
      await updateTheme({ themeId, name: editName, tokens: editTokens });
      setEditingId(null);
    });
  }

  if (themes === undefined || me === undefined) {
    return <p className="text-sm text-neutral-500">Loading…</p>;
  }

  // Group by station name; org-wide presets sort last (stationSlug === null).
  const groups = new Map<string, ThemeRow[]>();
  for (const t of themes as ThemeRow[]) {
    const arr = groups.get(t.stationName) ?? [];
    arr.push(t);
    groups.set(t.stationName, arr);
  }

  return (
    <div className="flex flex-col gap-8">
      {error !== null && <p className="text-sm text-red-600">{error}</p>}

      {!isAdmin && (
        <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800">
          You can view themes. Creating, editing, and deleting themes requires an admin role.
        </p>
      )}

      {isAdmin && (
        <section className="rounded-lg border border-neutral-200 p-5">
          <h2 className="mb-4 text-sm font-semibold uppercase tracking-wide text-neutral-500">
            New theme
          </h2>
          <form onSubmit={onCreate} className="flex flex-col gap-4">
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-neutral-500">Name</span>
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Fundraiser Red"
                  className="rounded-md border border-neutral-300 px-3 py-2"
                />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                <span className="text-neutral-500">Scope</span>
                <select
                  value={newScope}
                  onChange={(e) => setNewScope(e.target.value)}
                  className="rounded-md border border-neutral-300 px-3 py-2"
                >
                  {CMS_STATIONS.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                  <option value="org">org-wide preset</option>
                </select>
              </label>
            </div>
            <ThemeTokenForm value={newTokens} onChange={setNewTokens} />
            <div>
              <button
                type="submit"
                disabled={creating}
                className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {creating ? "Creating…" : "Create theme"}
              </button>
            </div>
          </form>
        </section>
      )}

      {[...groups.entries()].map(([stationName, rows]) => (
        <section key={stationName} className="flex flex-col gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
            {stationName}
          </h2>
          <ul className="flex flex-col divide-y divide-neutral-200 rounded-lg border border-neutral-200">
            {rows.map((theme) => (
              <li key={theme._id} className="flex flex-col gap-3 px-4 py-3">
                <div className="flex flex-wrap items-center gap-3">
                  <Swatches tokens={theme.tokens} />
                  <span className="min-w-0 flex-1 font-medium">{theme.name}</span>
                  {theme.isStationDefault && (
                    <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-medium text-green-800">
                      Station default
                    </span>
                  )}
                  {isAdmin && (
                    <>
                      <button
                        type="button"
                        onClick={() =>
                          editingId === theme._id ? setEditingId(null) : startEdit(theme)
                        }
                        className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium"
                      >
                        {editingId === theme._id ? "Close" : "Edit"}
                      </button>
                      {theme.stationSlug !== null && !theme.isStationDefault && (
                        <button
                          type="button"
                          onClick={() => runAction(() => setStationDefault({ themeId: theme._id }))}
                          className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium"
                        >
                          Set as default
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Delete theme "${theme.name}"?`)) {
                            void runAction(() => removeTheme({ themeId: theme._id }));
                          }
                        }}
                        className="rounded-md border border-red-300 px-3 py-1.5 text-sm font-medium text-red-700"
                      >
                        Delete
                      </button>
                    </>
                  )}
                </div>
                {isAdmin && editingId === theme._id && (
                  <div className="flex flex-col gap-3 rounded-md bg-neutral-50 p-4">
                    <label className="flex flex-col gap-1 text-sm">
                      <span className="text-neutral-500">Name</span>
                      <input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        className="rounded-md border border-neutral-300 px-3 py-2"
                      />
                    </label>
                    <ThemeTokenForm value={editTokens} onChange={setEditTokens} />
                    <div>
                      <button
                        type="button"
                        onClick={() => onSaveEdit(theme._id)}
                        className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-semibold text-white"
                      >
                        Save changes
                      </button>
                    </div>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
