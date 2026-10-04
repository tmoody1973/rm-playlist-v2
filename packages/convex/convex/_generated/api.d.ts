/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as alexa from "../alexa.js";
import type * as appleMusic from "../appleMusic.js";
import type * as appleMusicLinks from "../appleMusicLinks.js";
import type * as appleOutcome from "../appleOutcome.js";
import type * as artistWatch from "../artistWatch.js";
import type * as backfills from "../backfills.js";
import type * as cadence from "../cadence.js";
import type * as cadenceSong from "../cadenceSong.js";
import type * as cadenceSummary from "../cadenceSummary.js";
import type * as credits from "../credits.js";
import type * as crons from "../crons.js";
import type * as enrichment from "../enrichment.js";
import type * as events from "../events.js";
import type * as factValidators from "../factValidators.js";
import type * as finds from "../finds.js";
import type * as findsApple from "../findsApple.js";
import type * as findsLogic from "../findsLogic.js";
import type * as health from "../health.js";
import type * as healthRules from "../healthRules.js";
import type * as ingestionEvents from "../ingestionEvents.js";
import type * as ingestionSources from "../ingestionSources.js";
import type * as listenerGuard from "../listenerGuard.js";
import type * as matchKey from "../matchKey.js";
import type * as memoryLogic from "../memoryLogic.js";
import type * as notifications from "../notifications.js";
import type * as playDuration from "../playDuration.js";
import type * as plays from "../plays.js";
import type * as preview from "../preview.js";
import type * as recall from "../recall.js";
import type * as reports from "../reports.js";
import type * as seed from "../seed.js";
import type * as showsByMetro from "../showsByMetro.js";
import type * as stationRegions from "../stationRegions.js";
import type * as stations from "../stations.js";
import type * as tokenCrypto from "../tokenCrypto.js";
import type * as users from "../users.js";

import type { ApiFromModules, FilterApi, FunctionReference } from "convex/server";

declare const fullApi: ApiFromModules<{
  alexa: typeof alexa;
  appleMusic: typeof appleMusic;
  appleMusicLinks: typeof appleMusicLinks;
  appleOutcome: typeof appleOutcome;
  artistWatch: typeof artistWatch;
  backfills: typeof backfills;
  cadence: typeof cadence;
  cadenceSong: typeof cadenceSong;
  cadenceSummary: typeof cadenceSummary;
  credits: typeof credits;
  crons: typeof crons;
  enrichment: typeof enrichment;
  events: typeof events;
  factValidators: typeof factValidators;
  finds: typeof finds;
  findsApple: typeof findsApple;
  findsLogic: typeof findsLogic;
  health: typeof health;
  healthRules: typeof healthRules;
  ingestionEvents: typeof ingestionEvents;
  ingestionSources: typeof ingestionSources;
  listenerGuard: typeof listenerGuard;
  matchKey: typeof matchKey;
  memoryLogic: typeof memoryLogic;
  notifications: typeof notifications;
  playDuration: typeof playDuration;
  plays: typeof plays;
  preview: typeof preview;
  recall: typeof recall;
  reports: typeof reports;
  seed: typeof seed;
  showsByMetro: typeof showsByMetro;
  stationRegions: typeof stationRegions;
  stations: typeof stations;
  tokenCrypto: typeof tokenCrypto;
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
export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>;

export declare const components: {};
