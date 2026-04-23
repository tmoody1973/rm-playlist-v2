import type { AdapterKind, NormalizedPlay, StationSlug } from "@rm/types";

/** Context passed to every `parse()` call so adapters know which station they're working on. */
export interface AdapterParseContext {
  stationSlug: StationSlug;
}

/**
 * An ingestion adapter.
 *
 * `parse()` is the invariant — it NEVER throws. Any malformed input, missing
 * fields, or unexpected shape → empty array. This property is enforced by the
 * fast-check property test in `test/parse-never-throws.property.test.ts` (TODO-3).
 *
 * `poll()` is optional — adapters that fetch via HTTP implement it. It's allowed
 * to throw on network/auth errors; Trigger.dev handles retries per its config.
 */
export interface AdapterContract<TPollConfig = unknown> {
  /** Identifier matching `AdapterKind`. Registry keys are this. */
  readonly kind: AdapterKind;

  /**
   * Given arbitrary raw input (JSON object, string, buffer, anything), produce
   * zero or more NormalizedPlays. NEVER throws.
   */
  parse(raw: unknown, context: AdapterParseContext): NormalizedPlay[];

  /**
   * Optional: fetch the current batch of plays from the source. Called by
   * scheduled Trigger.dev tasks. May throw on HTTP / auth / network errors.
   */
  poll?(config: TPollConfig, context: AdapterParseContext): Promise<NormalizedPlay[]>;
}
