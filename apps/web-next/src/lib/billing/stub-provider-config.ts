/**
 * STUB-deploy — register the C0 stub as a resolvable BillingProvider.
 *
 * The stub is the SECOND Billing Provider Protocol implementation (after the
 * reference provider, pymthouse). Standing it up as a registered provider proves
 * a NaaP team can bind to a *different* provider with no NaaP/app code change
 * (generalization scenario E8; enforced by INT-G).
 *
 * "Deploy" here means: a `BillingProvider{slug:"stub", adapterType:"stub"}`
 * catalog row + the in-process `StubAdapter` in the registry. The stub holds NO
 * secrets and talks to NO external service, so there is nothing to provision —
 * unlike pymthouse it needs no env wiring. It is `enabled:false` in the catalog
 * so it never appears in the production provider picker; binding a team's
 * `billingAccountRef.providerSlug` to "stub" is an explicit, opt-in action.
 */

import 'server-only';

import { randomUUID } from 'node:crypto';

import { getBillingProviderAdapter, hasBillingProviderAdapter } from './registry';
import { STUB_ADAPTER_SLUG } from './stub-adapter';

export const STUB_PROVIDER_SLUG = STUB_ADAPTER_SLUG; // "stub"

/**
 * Env gate for surfacing the stub in non-catalog contexts (e.g. an admin
 * "switch team to stub" affordance). Default OFF — production never enables it.
 * Resolution through the front door does NOT depend on this; it is a UX gate.
 */
export const STUB_PROVIDER_DEPLOY_ENV = 'NAAP_ENABLE_STUB_PROVIDER';

/** True when an operator has explicitly opted the stub in (non-prod / staging). */
export function isStubProviderDeployEnabled(): boolean {
  const v = process.env[STUB_PROVIDER_DEPLOY_ENV];
  return typeof v === 'string' && /^(1|true|yes|on)$/i.test(v.trim());
}

/** Minimal shape of a seeded `BillingProvider` row. */
export interface SeedProviderLike {
  readonly slug: string;
  readonly enabled: boolean;
  readonly adapterType?: string | null;
}

/** Find the stub entry in a seed/catalog list. */
export function findStubSeed(
  providers: readonly SeedProviderLike[],
): SeedProviderLike | undefined {
  return providers.find((p) => p.slug === STUB_PROVIDER_SLUG);
}

/**
 * True when the catalog declares the stub as a registered provider whose
 * `adapterType` resolves to the stub adapter. (We do not require `enabled:true`
 * — the stub is intentionally catalog-disabled but still resolvable.)
 */
export function isStubSeedRegistered(providers: readonly SeedProviderLike[]): boolean {
  const seed = findStubSeed(providers);
  if (!seed) return false;
  const adapterType = seed.adapterType ?? seed.slug;
  return adapterType === STUB_PROVIDER_SLUG;
}

/** True when the registry can resolve the stub adapter (BPP ② surface present). */
export function isStubAdapterResolvable(): boolean {
  return hasBillingProviderAdapter(STUB_PROVIDER_SLUG);
}

export interface StubDeployStatus {
  /** The stub adapter is registered and resolvable in the registry. */
  adapterResolvable: boolean;
  /** The catalog seed registers the stub with a stub-resolving adapterType. */
  seedRegistered: boolean;
  /** Operator has opted the stub in for non-catalog UX (default false). */
  deployEnabled: boolean;
}

/** Minimal structured logger surface (console satisfies it). */
export interface StructuredLogger {
  info?: (message: string) => void;
  log?: (message: string) => void;
  warn?: (message: string) => void;
}

/**
 * Emit a single structured log line describing the stub deploy status. The stub
 * has no secrets/PII, so nothing is redacted. Returns the status for assertions.
 */
export function logStubDeployStatus(
  providers: readonly SeedProviderLike[],
  logger: StructuredLogger = console,
  correlationId: string = randomUUID(),
): StubDeployStatus {
  const status: StubDeployStatus = {
    adapterResolvable: isStubAdapterResolvable(),
    seedRegistered: isStubSeedRegistered(providers),
    deployEnabled: isStubProviderDeployEnabled(),
  };
  const line = JSON.stringify({
    level: status.adapterResolvable && status.seedRegistered ? 'info' : 'warn',
    event: 'billing.provider.stub.deploy_status',
    correlationId,
    ...status,
  });
  const emit =
    status.adapterResolvable && status.seedRegistered
      ? (logger.info ?? logger.log)
      : (logger.warn ?? logger.log);
  emit?.call(logger, line);
  return status;
}

/** The stub adapter instance (for callers that resolve it explicitly). */
export function getStubAdapter() {
  return getBillingProviderAdapter(STUB_PROVIDER_SLUG);
}
