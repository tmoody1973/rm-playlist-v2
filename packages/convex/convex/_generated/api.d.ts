/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as appleMusic from "../appleMusic.js";
import type * as backfills from "../backfills.js";
import type * as enrichment from "../enrichment.js";
import type * as ingestionEvents from "../ingestionEvents.js";
import type * as ingestionSources from "../ingestionSources.js";
import type * as plays from "../plays.js";
import type * as reports from "../reports.js";
import type * as seed from "../seed.js";
import type * as stations from "../stations.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  appleMusic: typeof appleMusic;
  backfills: typeof backfills;
  enrichment: typeof enrichment;
  ingestionEvents: typeof ingestionEvents;
  ingestionSources: typeof ingestionSources;
  plays: typeof plays;
  reports: typeof reports;
  seed: typeof seed;
  stations: typeof stations;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
