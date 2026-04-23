import type { AdapterKind } from "@rm/types";
import type { AdapterContract } from "./types";
import { spinitronAdapter } from "./adapters/spinitron";
import { sgmetadataAdapter } from "./adapters/sgmetadata";
import { icyAdapter } from "./adapters/icy";

/**
 * Canonical adapter registry. Orchestration code reads from here —
 * `getAdapter("spinitron").parse(raw, ctx)`.
 */
export const registry: Record<AdapterKind, AdapterContract> = {
  spinitron: spinitronAdapter,
  sgmetadata: sgmetadataAdapter,
  icy: icyAdapter,
};

export function getAdapter(kind: AdapterKind): AdapterContract {
  const adapter = registry[kind];
  if (!adapter) {
    throw new Error(`Unknown adapter: ${kind}`);
  }
  return adapter;
}

/** Test-only helper for registering mock adapters. Never called in production. */
export function registerAdapter(kind: AdapterKind, adapter: AdapterContract): void {
  registry[kind] = adapter;
}
