/**
 * Application / service registry (NAAP-D).
 *
 * NaaP registers any application or service (the Storyboard app, the SDK
 * service, a CLI, a 3rd-party integration) as a provider-agnostic `Application`.
 * Each app presents its `appId` (via the `X-App-Id` header on the validation
 * front door, BPP ③) so usage and rate limits attribute *per app*. No app is
 * hardcoded — Storyboard is just one registered app among equals.
 *
 * This module holds the provider-neutral, DB-free logic (scope/capability
 * enforcement + attribution) so it can be unit-tested in isolation; the HTTP
 * routes under `src/app/api/v1/apps/*` persist `Application` rows.
 */

/** Feature flag gating the application registry surface (default OFF). */
export const APP_REGISTRY_FLAG = 'app_registry';

/** App kinds. Generic — not tied to any specific app. */
export const APP_TYPES = ['app', 'service', 'cli'] as const;
export type AppType = (typeof APP_TYPES)[number];

/**
 * Coarse scopes an app may be granted. These gate *which NaaP surfaces* an app
 * may use; fine-grained capability gating (pipeline × model × tool) is separate
 * (`allowedCapabilities`, enforced by NAAP-E).
 */
export const APP_SCOPES = ['discovery', 'gateway', 'llm', 'billing', 'usage'] as const;
export type AppScope = (typeof APP_SCOPES)[number];

/** Wildcard capability grant. */
export const CAPABILITY_WILDCARD = '*';

/** The minimal shape the registry logic needs (subset of the Prisma row). */
export interface RegisteredApp {
  id: string;
  slug: string;
  type: AppType;
  /** Exactly one of teamId / ownerUserId identifies the owning scope. */
  teamId: string | null;
  ownerUserId: string | null;
  allowedScopes: string[];
  allowedCapabilities: string[];
  status: string;
}

/** Stable per-app attribution key for usage/rate-limit accounting. */
export interface AppAttribution {
  appId: string;
  slug: string;
  /** Owning scope: a real `teamId` or `personal:{userId}`. */
  ownerScope: string;
}

export function isAppType(value: unknown): value is AppType {
  return typeof value === 'string' && (APP_TYPES as readonly string[]).includes(value);
}

export function isAppScope(value: unknown): value is AppScope {
  return typeof value === 'string' && (APP_SCOPES as readonly string[]).includes(value);
}

/** Validate a list of requested scopes; returns the unknown ones (empty = all valid). */
export function invalidScopes(scopes: string[]): string[] {
  return scopes.filter((s) => !isAppScope(s));
}

/**
 * Resolve an app's attribution key. Distinct apps always produce distinct
 * `appId`s, so usage attributes separately even within one owning team.
 */
export function resolveAppAttribution(app: RegisteredApp): AppAttribution {
  const ownerScope = app.teamId ?? (app.ownerUserId ? `personal:${app.ownerUserId}` : 'unknown');
  return { appId: app.id, slug: app.slug, ownerScope };
}

/** True when the app is active and has been granted the given coarse scope. */
export function appAllowsScope(app: RegisteredApp, scope: AppScope): boolean {
  if (app.status !== 'active') return false;
  return app.allowedScopes.includes(scope);
}

/**
 * True when the app may use a generic capability id (`<pipeline>:<model>` or
 * `tool:<name>`). A `*` grant allows any capability.
 */
export function appAllowsCapability(app: RegisteredApp, capability: string): boolean {
  if (app.status !== 'active') return false;
  if (app.allowedCapabilities.includes(CAPABILITY_WILDCARD)) return true;
  return app.allowedCapabilities.includes(capability);
}
