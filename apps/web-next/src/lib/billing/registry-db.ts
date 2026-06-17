/**
 * DB-driven billing-provider adapter registry (NAAP-A-db).
 *
 * NAAP-A keyed the registry by a STATIC slug→adapter map (`registry.ts`).
 * NAAP-A-db makes resolution DB-driven: a `BillingProvider` row's `adapterType`
 * column selects which `BillingProviderAdapter` implementation backs that
 * provider (many provider rows may share one adapterType, differentiated by the
 * `config` column). This lets operators add/retarget a provider without a code
 * change.
 *
 * Flag-gated (`db_adapter_registry`, default OFF). When OFF — or whenever the DB
 * lookup is unavailable, the row is missing, or the adapterType is unknown — it
 * FALLS BACK to the static registry keyed by slug. So flag-OFF (and any DB lag)
 * is a no-op with zero regression versus NAAP-A.
 *
 * Never logs secrets/PII — only the slug, resolved adapterType, and resolution
 * source.
 */

import 'server-only';

import { prisma } from '@/lib/db';
import { isFeatureEnabled } from '@/lib/feature-flags';

import type { BillingProviderAdapter } from './adapter';
import { PymthouseAdapter } from './pymthouse-adapter';
import { StubAdapter } from './stub-adapter';
import { getBillingProviderAdapter } from './registry';

export const DB_ADAPTER_REGISTRY_FLAG = 'db_adapter_registry';

/** How a provider's adapter was resolved (for structured logging/telemetry). */
export type AdapterResolutionSource =
  | 'static' // flag OFF, or fell back to the static slug→adapter map
  | 'db' // resolved from BillingProvider.adapterType via a DB factory
  | 'db-fallback-static'; // flag ON but row/adapterType unusable → static

export interface AdapterResolution {
  adapter: BillingProviderAdapter | undefined;
  source: AdapterResolutionSource;
  adapterType: string | null;
}

type AdapterFactory = () => BillingProviderAdapter;

/** adapterType → adapter implementation factory. */
function buildDefaultFactories(): Map<string, AdapterFactory> {
  return new Map<string, AdapterFactory>([
    ['pymthouse', () => new PymthouseAdapter()],
    ['stub', () => new StubAdapter()],
  ]);
}

let factories: Map<string, AdapterFactory> = buildDefaultFactories();
/** Memoized adapter instances per adapterType (adapters are stateless). */
let instanceCache: Map<string, BillingProviderAdapter> = new Map();

function instantiate(adapterType: string): BillingProviderAdapter | undefined {
  const cached = instanceCache.get(adapterType);
  if (cached) {
    return cached;
  }
  const factory = factories.get(adapterType);
  if (!factory) {
    return undefined;
  }
  const adapter = factory();
  instanceCache.set(adapterType, adapter);
  return adapter;
}

/**
 * Resolve a provider slug → adapter, DB-driven when the flag is ON. Returns the
 * resolution source so callers can log/telemeter without a second lookup.
 *
 * Resolution order when the flag is ON:
 *  1. Look up the BillingProvider row by slug; read `adapterType`.
 *  2. adapterType (or slug when NULL) → adapter factory → instance.
 *  3. On any miss/error → static registry by slug (zero-regression fallback).
 */
export async function resolveBillingProviderAdapterDetailed(
  slug: string,
): Promise<AdapterResolution> {
  let flagOn = false;
  try {
    flagOn = await isFeatureEnabled(DB_ADAPTER_REGISTRY_FLAG);
  } catch {
    flagOn = false;
  }

  if (!flagOn) {
    return { adapter: getBillingProviderAdapter(slug), source: 'static', adapterType: null };
  }

  try {
    const row = await prisma.billingProvider.findUnique({
      where: { slug },
      select: { adapterType: true },
    });

    const adapterType = row?.adapterType?.trim() || slug;
    const adapter = instantiate(adapterType);
    if (adapter) {
      return { adapter, source: 'db', adapterType };
    }
    // Unknown adapterType → fall back to the static slug map.
    return {
      adapter: getBillingProviderAdapter(slug),
      source: 'db-fallback-static',
      adapterType,
    };
  } catch {
    // DB unavailable / lagging → never hard-fail; keep the static behavior.
    return {
      adapter: getBillingProviderAdapter(slug),
      source: 'db-fallback-static',
      adapterType: null,
    };
  }
}

/** Convenience wrapper returning just the adapter. */
export async function resolveBillingProviderAdapter(
  slug: string,
): Promise<BillingProviderAdapter | undefined> {
  return (await resolveBillingProviderAdapterDetailed(slug)).adapter;
}

// ── Test seams ──

/** Register/override an adapterType factory (tests / future dynamic config). */
export function registerAdapterFactoryForTests(
  adapterType: string,
  factory: AdapterFactory,
): void {
  factories.set(adapterType, factory);
  instanceCache.delete(adapterType);
}

/** Reset factories + instance cache to defaults (test isolation). */
export function resetAdapterFactoriesForTests(): void {
  factories = buildDefaultFactories();
  instanceCache = new Map();
}
