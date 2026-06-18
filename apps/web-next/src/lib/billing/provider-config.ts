/**
 * NAAP-0 — pymthouse BillingProvider env wiring + seed verification.
 *
 * Server-only. Reports the *presence* of the `PYMTHOUSE_*` env vars and whether
 * the configured issuer/client match the staging reference values. It NEVER
 * returns or logs the M2M client secret value (presence is computed without
 * exposing it) — only a boolean indicating whether it is set.
 */

import 'server-only';

import { randomUUID } from 'node:crypto';
import {
  isPymthouseConfigured,
  getPymthouseIssuerUrlFromEnv,
  getPymthousePublicClientIdFromEnv,
} from '@pymthouse/builder-sdk/config';

export const PYMTHOUSE_PROVIDER_SLUG = 'pymthouse';

/**
 * Public (non-secret) staging reference values from the execution handover.
 * The OIDC issuer origin and the public/M2M client id are NOT secrets. The M2M
 * client *secret* is provided ONLY via `PYMTHOUSE_M2M_CLIENT_SECRET` and is never
 * stored here.
 */
export const PYMTHOUSE_STAGING_ISSUER_ORIGIN = 'https://staging.pymthouse.com';
export const PYMTHOUSE_STAGING_CLIENT_ID = 'app_2d89999406f9be57dd0233de';

/** Env vars the pymthouse adapter requires (secret listed last, never logged). */
export const PYMTHOUSE_ENV_VARS = [
  'PYMTHOUSE_ISSUER_URL',
  'PYMTHOUSE_PUBLIC_CLIENT_ID',
  'PYMTHOUSE_M2M_CLIENT_ID',
  'PYMTHOUSE_M2M_CLIENT_SECRET',
] as const;
export type PymthouseEnvVar = (typeof PYMTHOUSE_ENV_VARS)[number];

export interface PymthouseEnvStatus {
  /** True when all required vars are present (delegates to the SDK). */
  configured: boolean;
  /** Presence booleans only — values (especially the secret) are never exposed. */
  present: Record<PymthouseEnvVar, boolean>;
  /** Names of the missing required vars. */
  missing: PymthouseEnvVar[];
  /** Configured issuer origin matches the staging reference. */
  issuerMatchesStaging: boolean;
  /** Configured public client id matches the staging reference. */
  clientIdMatchesStaging: boolean;
}

function isPresent(name: PymthouseEnvVar): boolean {
  const value = process.env[name];
  return typeof value === 'string' && value.trim().length > 0;
}

/** Inspect `PYMTHOUSE_*` env wiring without ever touching the secret value. */
export function verifyPymthouseEnv(): PymthouseEnvStatus {
  const present = PYMTHOUSE_ENV_VARS.reduce(
    (acc, name) => {
      acc[name] = isPresent(name);
      return acc;
    },
    {} as Record<PymthouseEnvVar, boolean>,
  );

  const missing = PYMTHOUSE_ENV_VARS.filter((name) => !present[name]);

  let issuerMatchesStaging = false;
  const issuer = getPymthouseIssuerUrlFromEnv();
  if (issuer) {
    try {
      issuerMatchesStaging = new URL(issuer).origin === PYMTHOUSE_STAGING_ISSUER_ORIGIN;
    } catch {
      issuerMatchesStaging = false;
    }
  }

  const clientIdMatchesStaging =
    getPymthousePublicClientIdFromEnv() === PYMTHOUSE_STAGING_CLIENT_ID;

  return {
    configured: isPymthouseConfigured(),
    present,
    missing,
    issuerMatchesStaging,
    clientIdMatchesStaging,
  };
}

/** Minimal structured logger surface (console satisfies it). */
export interface StructuredLogger {
  info?: (message: string) => void;
  log?: (message: string) => void;
  warn?: (message: string) => void;
}

/**
 * Emit a single structured log line describing the pymthouse env wiring.
 * Logs presence booleans only — never the secret value. Returns the status so
 * callers (e.g. a CI presence check) can assert on it.
 */
export function logPymthouseEnvStatus(
  logger: StructuredLogger = console,
  correlationId: string = randomUUID(),
): PymthouseEnvStatus {
  const status = verifyPymthouseEnv();
  const line = JSON.stringify({
    level: status.configured ? 'info' : 'warn',
    event: 'billing.provider.pymthouse.env_verify',
    correlationId,
    configured: status.configured,
    present: status.present,
    missing: status.missing,
    issuerMatchesStaging: status.issuerMatchesStaging,
    clientIdMatchesStaging: status.clientIdMatchesStaging,
  });
  const emit = status.configured
    ? (logger.info ?? logger.log)
    : (logger.warn ?? logger.log);
  emit?.call(logger, line);
  return status;
}

/** Minimal shape of a seeded `BillingProvider` row (from `@naap/database`). */
export interface SeedProviderLike {
  readonly slug: string;
  readonly enabled: boolean;
}

/** Find the pymthouse entry in a seed/catalog list. */
export function findPymthouseSeed(
  providers: readonly SeedProviderLike[],
): SeedProviderLike | undefined {
  return providers.find((p) => p.slug === PYMTHOUSE_PROVIDER_SLUG);
}

/** True when the seed declares `BillingProvider{slug:pymthouse, enabled:true}`. */
export function isPymthouseSeedEnabled(providers: readonly SeedProviderLike[]): boolean {
  return findPymthouseSeed(providers)?.enabled === true;
}
