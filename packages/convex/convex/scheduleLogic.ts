import { localDateKey, localParts } from "./cadenceSong";

/**
 * Pure station-schedule logic for the Cadence program cache
 * (cadence.refreshStationSchedule writes it, alexa:stationSchedule reads it).
 *
 * Airtimes are channel-local civil time (America/Chicago): a show that runs
 * 10 PM–midnight Friday is { dayOfWeek: 5, startMin: 1320, endMin: 1440 } in
 * both CDT and CST. A show crossing midnight keeps counting past 1440, so
 * Saturday 11 PM–2 AM is { dayOfWeek: 6, startMin: 1380, endMin: 1560 }.
 */

export const SCHEDULE_TIME_ZONE = "America/Chicago";

export interface Airtime {
  /** 0 = Sunday … 6 = Saturday. */
  dayOfWeek: number;
  startMin: number;
  endMin: number;
}

export interface ScheduleProgram {
  programId: string;
  name: string;
  hosts: string[];
  description?: string;
  link?: string;
  airtimes: Airtime[];
}

export interface Airing {
  startsAt: number;
  endsAt: number;
}

export interface ScheduleSlot extends Airing {
  name: string;
  hosts: string[];
}

const MINUTES_PER_DAY = 1440;
const MS_PER_MINUTE = 60_000;
const DAYS_IN_WEEK = 7;
/** Occurrences are expanded this many civil days either side of `at`: covers a full week back and forward. */
const SCAN_DAYS = 8;
/** A query matches a program when at least this share of its words appear in the name or a host. */
const MIN_COVERAGE = 0.5;
/** A host like Kenny Perez has a few shows; more than this is a vague query. */
const MAX_MATCHES = 5;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const QUERY_STOPWORDS = new Set(["88nine", "the", "show", "with", "a", "on"]);

// --- hosts -----------------------------------------------------------------

/** "88Nine Weekends with Britt Gottschalk" → ["Britt Gottschalk"]. */
export function hostsFromName(name: string): string[] {
  const host = /\bwith\s+(.+)$/i.exec(name.trim())?.[1]?.trim();
  return host ? [host] : [];
}

/** Cadence hosts, else the name's "with <Name>"; `displayHost: false` hides hosts entirely. */
export function programHosts(detail: {
  programName: string;
  hosts?: string[];
  displayHost?: boolean;
}): string[] {
  if (detail.displayHost === false) return [];
  const hosts = (detail.hosts ?? []).map((h) => h.trim()).filter((h) => h.length > 0);
  return hosts.length > 0 ? hosts : hostsFromName(detail.programName);
}

// --- Cadence → cache rows --------------------------------------------------

const LOCAL_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})/;

/** Weekly airtime from an episode's channel-local ISO start/end, e.g. "2026-10-09T22:00:00-05:00". */
export function airtimeFromEpisode(startLocal: string, endLocal: string): Airtime | null {
  const start = LOCAL_TIME.exec(startLocal);
  const end = LOCAL_TIME.exec(endLocal);
  if (!start || !end) return null;
  const dayGap = (dayNumber(end[1]!) - dayNumber(start[1]!)) * MINUTES_PER_DAY;
  return {
    dayOfWeek: new Date(dayNumber(start[1]!) * MINUTES_PER_DAY * MS_PER_MINUTE).getUTCDay(),
    startMin: Number(start[2]) * 60 + Number(start[3]),
    endMin: dayGap + Number(end[2]) * 60 + Number(end[3]),
  };
}

/** Cadence widget `date` range: today through six days on, channel-local. */
export function weekDateRange(now: number): string {
  const today = localDateKey(now, SCHEDULE_TIME_ZONE);
  return `${today},${addDays(today, DAYS_IN_WEEK - 1)}`;
}

interface ProgramDetail {
  programId?: unknown;
  programName?: unknown;
  hosts?: unknown;
  displayHost?: unknown;
  description?: unknown;
  link?: unknown;
}

interface EpisodeRow {
  programId?: unknown;
  start?: { local?: unknown };
  end?: { local?: unknown };
}

/** Joins Cadence program details to the weekly airtimes their episodes show. */
export function buildSchedulePrograms(
  details: readonly unknown[],
  episodes: readonly unknown[],
): ScheduleProgram[] {
  const airtimes = airtimesByProgram(episodes);
  return details.flatMap((raw) => {
    const detail = (raw ?? {}) as ProgramDetail;
    const programId = nonEmpty(detail.programId);
    const name = nonEmpty(detail.programName);
    if (!programId || !name) return [];
    const description = nonEmpty(detail.description);
    const link = nonEmpty(detail.link);
    return [
      {
        programId,
        name,
        hosts: programHosts({
          programName: name,
          hosts: Array.isArray(detail.hosts) ? detail.hosts.filter(isString) : [],
          displayHost: detail.displayHost === false ? false : undefined,
        }),
        ...(description ? { description } : {}),
        ...(link ? { link } : {}),
        airtimes: airtimes.get(programId) ?? [],
      },
    ];
  });
}

function airtimesByProgram(episodes: readonly unknown[]): Map<string, Airtime[]> {
  const byProgram = new Map<string, Map<string, Airtime>>();
  for (const raw of episodes) {
    const episode = (raw ?? {}) as EpisodeRow;
    const programId = nonEmpty(episode.programId);
    const start = nonEmpty(episode.start?.local);
    const end = nonEmpty(episode.end?.local);
    const airtime = programId && start && end ? airtimeFromEpisode(start, end) : null;
    if (!programId || !airtime) continue;
    const slots = byProgram.get(programId) ?? new Map<string, Airtime>();
    slots.set(`${airtime.dayOfWeek}|${airtime.startMin}|${airtime.endMin}`, airtime);
    byProgram.set(programId, slots);
  }
  return new Map(
    [...byProgram].map(([id, slots]) => [
      id,
      [...slots.values()].sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMin - b.startMin),
    ]),
  );
}

// --- on now / next ---------------------------------------------------------

interface Occurrence extends Airing {
  program: ScheduleProgram;
}

export function scheduleAt(
  programs: readonly ScheduleProgram[],
  at: number,
): { onNow: ScheduleSlot | null; next: ScheduleSlot | null } {
  const all = occurrencesAround(programs, at);
  const live = all.filter((o) => o.startsAt <= at && at < o.endsAt);
  const onNow = live.sort((a, b) => b.startsAt - a.startsAt)[0];
  const next = all.filter((o) => o.startsAt > at).sort((a, b) => a.startsAt - b.startsAt)[0];
  return { onNow: onNow ? toSlot(onNow) : null, next: next ? toSlot(next) : null };
}

function toSlot({ program, startsAt, endsAt }: Occurrence): ScheduleSlot {
  return { name: program.name, hosts: program.hosts, startsAt, endsAt };
}

function occurrencesAround(programs: readonly ScheduleProgram[], at: number): Occurrence[] {
  const today = localDateKey(at, SCHEDULE_TIME_ZONE);
  const occurrences: Occurrence[] = [];
  for (let offset = -SCAN_DAYS; offset <= SCAN_DAYS; offset++) {
    const day = addDays(today, offset);
    const dayOfWeek = new Date(dayNumber(day) * MINUTES_PER_DAY * MS_PER_MINUTE).getUTCDay();
    for (const program of programs) {
      for (const airtime of program.airtimes) {
        if (airtime.dayOfWeek !== dayOfWeek) continue;
        occurrences.push({
          program,
          startsAt: civilToMs(day, airtime.startMin),
          endsAt: civilToMs(day, airtime.endMin),
        });
      }
    }
  }
  return occurrences;
}

// --- find a program --------------------------------------------------------

export interface ProgramMatch {
  name: string;
  hosts: string[];
  airtimes: Array<Airtime & { day: string; start: string; end: string }>;
  /** Most recent airing that started at or before `at` (may still be on). */
  lastAired: Airing | null;
  nextAiring: Airing | null;
  airingNow: boolean;
}

interface Candidate {
  program: ScheduleProgram;
  coverage: number;
  viaName: boolean;
  lastAired: Airing | null;
  nextAiring: Airing | null;
  airingNow: boolean;
}

/** "rhythm lab", "erin wolf", "did I miss audio taste test" → matching programs, best first. */
export function findPrograms(
  programs: readonly ScheduleProgram[],
  query: string,
  at: number,
): ProgramMatch[] {
  const words = queryWords(query);
  if (words.length === 0) return [];
  return programs
    .map((program) => candidate(program, words, at))
    .filter((c) => c.coverage >= MIN_COVERAGE)
    .sort(compareCandidates(at))
    .slice(0, MAX_MATCHES)
    .map(toMatch);
}

export function findProgram(
  programs: readonly ScheduleProgram[],
  query: string,
  at: number,
): ProgramMatch | null {
  return findPrograms(programs, query, at)[0] ?? null;
}

function candidate(program: ScheduleProgram, words: string[], at: number): Candidate {
  const nameCoverage = coverage(words, queryWords(program.name));
  const hostCoverage = Math.max(0, ...program.hosts.map((h) => coverage(words, queryWords(h))));
  const airings = occurrencesAround([program], at);
  const started = airings.filter((o) => o.startsAt <= at).sort((a, b) => b.startsAt - a.startsAt);
  const upcoming = airings.filter((o) => o.startsAt > at).sort((a, b) => a.startsAt - b.startsAt);
  const lastAired = started[0] ? airing(started[0]) : null;
  return {
    program,
    coverage: Math.max(nameCoverage, hostCoverage),
    viaName: nameCoverage > 0 && nameCoverage >= hostCoverage,
    lastAired,
    nextAiring: upcoming[0] ? airing(upcoming[0]) : null,
    airingNow: lastAired !== null && at < lastAired.endsAt,
  };
}

/** Best coverage, then name over host, then shows that air, then whichever is on soonest. */
function compareCandidates(at: number) {
  const soonest = (c: Candidate) =>
    c.airingNow ? at : (c.nextAiring?.startsAt ?? Number.POSITIVE_INFINITY);
  return (a: Candidate, b: Candidate) =>
    b.coverage - a.coverage ||
    Number(b.viaName) - Number(a.viaName) ||
    Number(b.program.airtimes.length > 0) - Number(a.program.airtimes.length > 0) ||
    soonest(a) - soonest(b);
}

function toMatch(c: Candidate): ProgramMatch {
  return {
    name: c.program.name,
    hosts: c.program.hosts,
    airtimes: c.program.airtimes.map((a) => ({
      ...a,
      day: DAY_NAMES[a.dayOfWeek] ?? "",
      start: clockLabel(a.startMin),
      end: clockLabel(a.endMin),
    })),
    lastAired: c.lastAired,
    nextAiring: c.nextAiring,
    airingNow: c.airingNow,
  };
}

function queryWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 0 && !QUERY_STOPWORDS.has(w));
}

function coverage(words: string[], target: string[]): number {
  if (target.length === 0) return 0;
  const have = new Set(target);
  return words.filter((w) => have.has(w)).length / words.length;
}

function airing({ startsAt, endsAt }: Occurrence): Airing {
  return { startsAt, endsAt };
}

/** 1320 → "10 PM", 630 → "10:30 AM", 1440 → "12 AM". */
function clockLabel(minutes: number): string {
  const ofDay = minutes % MINUTES_PER_DAY;
  const hour24 = Math.floor(ofDay / 60);
  const minute = ofDay % 60;
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  const suffix = hour24 < 12 ? "AM" : "PM";
  return minute === 0
    ? `${hour12} ${suffix}`
    : `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`;
}

// --- civil-time arithmetic -------------------------------------------------

/** Days since the epoch for a "yyyy-MM-dd" key. */
function dayNumber(key: string): number {
  const [year, month, day] = key.split("-").map(Number);
  return Date.UTC(year!, month! - 1, day!) / (MINUTES_PER_DAY * MS_PER_MINUTE);
}

function addDays(key: string, days: number): string {
  return new Date((dayNumber(key) + days) * MINUTES_PER_DAY * MS_PER_MINUTE)
    .toISOString()
    .slice(0, 10);
}

/** Epoch ms for `minutes` past local midnight of `day` in the channel zone; minutes may exceed a day. */
function civilToMs(day: string, minutes: number): number {
  const naive = (dayNumber(day) * MINUTES_PER_DAY + minutes) * MS_PER_MINUTE;
  // Two passes: the offset at the first guess can differ across a DST change.
  const firstGuess = naive - zoneOffsetMs(naive);
  return naive - zoneOffsetMs(firstGuess);
}

function zoneOffsetMs(ms: number): number {
  const p = localParts(ms, SCHEDULE_TIME_ZONE);
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

// --- tiny guards -----------------------------------------------------------

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function nonEmpty(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}
