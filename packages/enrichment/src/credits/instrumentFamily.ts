export type InstrumentFamily =
  | "horns" | "strings" | "keys" | "guitar" | "bass" | "drums" | "percussion" | "vocals" | "electronic";

/** Escape regex special characters for safe use in RegExp. */
function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Checked in order; first keyword matched at word start wins. Bass before guitar ("bass guitar"). */
const FAMILY_KEYWORDS: ReadonlyArray<readonly [InstrumentFamily, readonly string[]]> = [
  ["horns", ["trumpet", "trombone", "saxophone", "sax", "flugelhorn", "horn", "tuba", "cornet", "clarinet", "flute", "brass", "woodwind"]],
  ["strings", ["violin", "viola", "cello", "double bass", "contrabass", "string", "harp"]],
  ["bass", ["bass"]],
  ["keys", ["piano", "keyboard", "keys", "organ", "rhodes", "wurlitzer", "clavinet", "synthesizer", "synth", "harpsichord"]],
  ["guitar", ["guitar", "banjo", "mandolin", "ukulele", "pedal steel"]],
  ["drums", ["drum"]],
  ["percussion", ["percussion", "conga", "bongo", "shaker", "tambourine", "vibraphone", "marimba", "timbales", "cajón", "cajon"]],
  ["vocals", ["vocal", "voice", "singer", "rap", "choir"]],
  ["electronic", ["programming", "programmed", "drum machine", "sampler", "turntables", "dj"]],
];

/** ponytail: instrument family mapping from role string. Word-start matching prevents false positives. */
export function instrumentFamily(role: string): InstrumentFamily | null {
  const lowered = role.toLowerCase();
  for (const [family, keywords] of FAMILY_KEYWORDS) {
    for (const keyword of keywords) {
      const pattern = new RegExp(`\\b${escapeRegExp(keyword)}`, "i");
      if (pattern.test(lowered)) return family;
    }
  }
  return null;
}
