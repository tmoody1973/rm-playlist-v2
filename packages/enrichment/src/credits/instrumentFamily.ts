export type InstrumentFamily =
  | "horns" | "strings" | "keys" | "guitar" | "bass" | "drums" | "percussion" | "vocals" | "electronic";

/** Escape regex special characters for safe use in RegExp. */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Keyword families in priority order (checked in order; first match wins). */
const FAMILY_KEYWORDS: ReadonlyArray<readonly [InstrumentFamily, readonly string[]]> = [
  ["horns", ["trumpet", "trombone", "saxophone", "sax", "flugelhorn", "horn", "tuba", "cornet", "clarinet", "flute", "brass", "woodwind", "bassoon", "oboe"]],
  ["keys", ["piano", "keyboard", "keys", "organ", "rhodes", "wurlitzer", "clavinet", "synthesizer", "synth", "harpsichord"]],
  ["strings", ["violin", "viola", "cello", "double bass", "contrabass", "string", "harp"]],
  ["bass", ["bass"]],
  ["guitar", ["guitar", "banjo", "mandolin", "ukulele", "pedal steel"]],
  ["electronic", ["programming", "programmed", "drum machine", "sampler", "turntables", "dj"]],
  ["drums", ["drum"]],
  ["percussion", ["percussion", "conga", "bongo", "shaker", "tambourine", "vibraphone", "marimba", "timbales", "cajón", "cajon", "djembe"]],
  ["vocals", ["vocal", "voice", "singer", "rap", "choir"]],
];

/** Short keywords that are prefixes of unrelated words ("Organized By", "Djembe"): whole-word match only. */
const WHOLE_WORD_KEYWORDS = new Set(["organ", "dj"]);

/** Precompiled regex patterns for each keyword (word-start match; whole word for WHOLE_WORD_KEYWORDS). */
const KEYWORD_PATTERNS: Map<string, RegExp> = new Map();
function getPattern(keyword: string): RegExp {
  if (!KEYWORD_PATTERNS.has(keyword)) {
    const end = WHOLE_WORD_KEYWORDS.has(keyword) ? "\\b" : "";
    KEYWORD_PATTERNS.set(keyword, new RegExp(`\\b${escapeRegExp(keyword)}${end}`, "i"));
  }
  return KEYWORD_PATTERNS.get(keyword)!;
}

/** ponytail: instrument family mapping from role string. Word-start matching prevents false positives. */
export function instrumentFamily(role: string): InstrumentFamily | null {
  const lowered = role.toLowerCase();
  for (const [family, keywords] of FAMILY_KEYWORDS) {
    for (const keyword of keywords) {
      if (getPattern(keyword).test(lowered)) return family;
    }
  }
  return null;
}
