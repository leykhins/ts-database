/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as auth from "../auth.js";
import type * as buildings from "../buildings.js";
import type * as care from "../care.js";
import type * as checks from "../checks.js";
import type * as crons from "../crons.js";
import type * as dashboard from "../dashboard.js";
import type * as deposits from "../deposits.js";
import type * as http from "../http.js";
import type * as maintenance from "../maintenance.js";
import type * as model from "../model.js";
import type * as needs from "../needs.js";
import type * as profile from "../profile.js";
import type * as rents from "../rents.js";
import type * as reports from "../reports.js";
import type * as rooms from "../rooms.js";
import type * as seed from "../seed.js";
import type * as services from "../services.js";
import type * as settings from "../settings.js";
import type * as shiftReports from "../shiftReports.js";
import type * as support from "../support.js";
import type * as tenants from "../tenants.js";
import type * as users from "../users.js";
import type * as visitors from "../visitors.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  buildings: typeof buildings;
  care: typeof care;
  checks: typeof checks;
  crons: typeof crons;
  dashboard: typeof dashboard;
  deposits: typeof deposits;
  http: typeof http;
  maintenance: typeof maintenance;
  model: typeof model;
  needs: typeof needs;
  profile: typeof profile;
  rents: typeof rents;
  reports: typeof reports;
  rooms: typeof rooms;
  seed: typeof seed;
  services: typeof services;
  settings: typeof settings;
  shiftReports: typeof shiftReports;
  support: typeof support;
  tenants: typeof tenants;
  users: typeof users;
  visitors: typeof visitors;
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
