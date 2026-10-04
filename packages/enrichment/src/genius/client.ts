import type { Throttle } from "../throttle";
import type { FetchLike } from "../types";

const API_BASE = "https://api.genius.com";

export class GeniusError extends Error {
  constructor(public readonly code: "rate_limited" | "upstream_5xx" | "other", public readonly status: number, message: string) {
    super(message);
    this.name = "GeniusError";
  }
}

export interface GeniusSong {
  id: number; url: string; title: string;
  primary_artist?: { id?: number; name?: string };
  producer_artists?: { id?: number; name?: string }[];
  writer_artists?: { id?: number; name?: string }[];
  song_relationships?: { relationship_type: string; songs: { id?: number; title?: string; primary_artist?: { name?: string } }[] }[];
}

interface GeniusAuthInput { readonly token: string; readonly throttle: Throttle; readonly signal?: AbortSignal; readonly fetch?: FetchLike }

async function geniusGet<T>(path: string, input: GeniusAuthInput): Promise<T | null> {
  const fetchImpl = input.fetch ?? globalThis.fetch;
  await input.throttle.acquire(input.signal);
  const res = await fetchImpl(`${API_BASE}${path}`, { headers: { Accept: "application/json", Authorization: `Bearer ${input.token}` }, signal: input.signal });
  if (res.status === 404) return null;
  if (res.status === 429) throw new GeniusError("rate_limited", 429, "genius 429");
  if (res.status >= 500) throw new GeniusError("upstream_5xx", res.status, `genius ${res.status}`);
  if (!res.ok) throw new GeniusError("other", res.status, `genius ${res.status}`);
  return (await res.json()) as T;
}

/** Same folding as convex/matchKey.ts (artist + title, alnum only). Exact match only — a wrong song means wrong samples. */
function songKey(artist: string, title: string): string {
  const fold = (text: string) => text.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\b(the|a|an)\b/g, "").replace(/[^a-z0-9]/g, "");
  return `${fold(artist)}::${fold(title)}`;
}

export async function searchGeniusSong(input: GeniusAuthInput & { readonly artist: string; readonly title: string }): Promise<number | null> {
  const json = await geniusGet<{ response?: { hits?: { type?: string; result?: { id: number; title?: string; primary_artist?: { name?: string } } }[] } }>(
    `/search?q=${encodeURIComponent(`${input.artist} ${input.title}`)}`, input);
  const wanted = songKey(input.artist, input.title);
  const hit = (json?.response?.hits ?? []).find((h) =>
    h.type === "song" && h.result !== undefined && songKey(h.result.primary_artist?.name ?? "", h.result.title ?? "") === wanted);
  return hit?.result?.id ?? null;
}

export async function fetchGeniusSong(input: GeniusAuthInput & { readonly songId: number }): Promise<GeniusSong | null> {
  const json = await geniusGet<{ response?: { song?: GeniusSong } }>(`/songs/${input.songId}?text_format=plain`, input);
  return json?.response?.song ?? null;
}
