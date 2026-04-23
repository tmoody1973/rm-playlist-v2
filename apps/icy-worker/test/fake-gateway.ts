import type { NormalizedPlay } from "@rm/types";
import type { ConvexGateway, IcySource, WriteResult } from "../src/convex-client";

/**
 * In-memory ConvexGateway fake for tests.
 *
 * Exposes knobs to:
 *   - drive `listIcySources()` with a scripted list (mutable between ticks)
 *   - flag unknown-source on writePlay to exercise the supervisor abort path
 *   - capture every write for end-to-end assertions
 *   - throw on either method to exercise error handling
 */
export class FakeGateway implements ConvexGateway {
  public sources: IcySource[] = [];
  public listThrows: Error | null = null;
  public writeThrows: Error | null = null;
  public unknownSourceIds = new Set<string>();
  public writes: Array<{ sourceId: string; play: NormalizedPlay }> = [];
  public duplicatePlayedAt = new Set<number>();
  public listCallCount = 0;

  async listIcySources(): Promise<IcySource[]> {
    this.listCallCount += 1;
    if (this.listThrows !== null) throw this.listThrows;
    return [...this.sources];
  }

  async writePlay(sourceId: string, play: NormalizedPlay): Promise<WriteResult> {
    if (this.writeThrows !== null) throw this.writeThrows;
    if (this.unknownSourceIds.has(sourceId)) {
      return { inserted: false, reason: "unknown_source", error: `Unknown source: ${sourceId}` };
    }
    if (this.duplicatePlayedAt.has(play.playedAt)) {
      return { inserted: false, reason: "duplicate" };
    }
    this.writes.push({ sourceId, play });
    return { inserted: true };
  }
}
