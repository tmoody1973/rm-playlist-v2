/**
 * Cross-app song key computed from plain artist + title strings.
 * Backstory carries an identical copy (decision 006); both repos run
 * test/fixtures/match-keys.json so the copies can't drift silently.
 *
 * Distinct from `tracks.trackKey`, which embeds a Convex artist id and
 * can't be computed outside this database.
 */
const COMBINING_MARKS = /[̀-ͯ]/g;
const ARTICLES = /\b(the|a|an)\b/g;
const NON_ALNUM = /[^a-z0-9]/g;
const FEATURED_SUFFIX = /\s*[([]?\s*\b(?:feat\.?|ft\.?|featuring)\s+[^)\]]*[)\]]?\s*$/i;
const EDIT_WORDS = "radio edit|single version|remaster(?:ed)?(?: \\d{4})?|\\d{4} remaster(?:ed)?";
const EDIT_SUFFIX = new RegExp(
  `\\s*(?:[([]\\s*(?:${EDIT_WORDS})\\s*[)\\]]|-\\s*(?:${EDIT_WORDS}))\\s*$`,
  "i",
);

function foldAccents(text: string): string {
  return text.toLowerCase().normalize("NFD").replace(COMBINING_MARKS, "");
}

/** Article-stripped, alnum-only artist key. Also the event-matching key (events.ts). */
export function normalizeArtistForMatch(name: string): string {
  return foldAccents(name).replace(ARTICLES, "").replace(NON_ALNUM, "");
}

function normalizeTitleForMatch(title: string): string {
  const stripped = title.replace(FEATURED_SUFFIX, "").replace(EDIT_SUFFIX, "");
  return foldAccents(stripped).replace(NON_ALNUM, "");
}

export function matchKey(artist: string, title: string): string {
  const artistPart = normalizeArtistForMatch(artist.replace(FEATURED_SUFFIX, ""));
  return `${artistPart}::${normalizeTitleForMatch(title)}`;
}
