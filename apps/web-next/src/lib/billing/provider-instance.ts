/**
 * Per-`ProviderInstance` adapter construction helpers (NAAP P0, multi-app).
 *
 * Building blocks used by the DB adapter registry (`registry-db.ts`) to turn a
 * `ProviderInstance` row into a configured `BillingProviderAdapter`:
 *   - parse the row's NON-SECRET `config` into typed connection params,
 *   - resolve the M2M secret from `SecretVault` by `secretRef` (never inline),
 *   - build a pymthouse adapter bound to a per-instance client.
 *
 * Secrets discipline: the secret VALUE never appears in `config`, is read only
 * via `SecretVault`, and is never logged. All new behavior is reachable only
 * when the `provider_instances` flag is ON (gated by the registry); these
 * helpers perform no flag check themselves.
 */

import 'server-only';

import { decryptV1 } from '@naap/crypto';

import { prisma } from '@/lib/db';
import { createPmtHouseClient } from '@/lib/pymthouse-client';

import type { BillingProviderAdapter } from './adapter';
import { PymthouseAdapter, PYMTHOUSE_ADAPTER_SLUG } from './pymthouse-adapter';

/** Minimal `ProviderInstance` shape the registry needs to build an adapter. */
export interface ProviderInstanceRecord {
  id: string;
  adapterType: string;
  slug: string;
  config: unknown;
  secretRef: string | null;
  enabled: boolean;
}

/** Non-secret pymthouse connection params parsed from `ProviderInstance.config`. */
export interface PymthouseInstanceConfig {
  issuerUrl: string;
  publicClientId: string;
  m2mClientId: string;
  allowInsecureHttp?: boolean;
}

/**
 * Parse a `ProviderInstance.config` JSON blob into typed pymthouse connection
 * params. Returns null when any required NON-SECRET field is missing/blank so
 * the caller can fall back rather than build a half-configured client. The M2M
 * secret is intentionally NOT part of config (it lives in `SecretVault`).
 */
export function parsePymthouseInstanceConfig(
  config: unknown,
): PymthouseInstanceConfig | null {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return null;
  }
  const c = config as Record<string, unknown>;
  const issuerUrl = typeof c.issuerUrl === 'string' ? c.issuerUrl.trim() : '';
  const publicClientId = typeof c.publicClientId === 'string' ? c.publicClientId.trim() : '';
  const m2mClientId = typeof c.m2mClientId === 'string' ? c.m2mClientId.trim() : '';
  if (!issuerUrl || !publicClientId || !m2mClientId) {
    return null;
  }
  const allowInsecureHttp =
    typeof c.allowInsecureHttp === 'boolean' ? c.allowInsecureHttp : undefined;
  return {
    issuerUrl,
    publicClientId,
    m2mClientId,
    ...(allowInsecureHttp !== undefined ? { allowInsecureHttp } : {}),
  };
}

/**
 * Resolve an instance's M2M secret from `SecretVault` by its `secretRef` (the
 * vault `key`). Returns null when the ref is blank, the row is missing, or
 * decryption fails — callers fall back rather than throw. Never logs the value.
 */
export async function getProviderInstanceSecret(secretRef: string): Promise<string | null> {
  const key = secretRef.trim();
  if (!key) {
    return null;
  }
  try {
    const row = await prisma.secretVault.findUnique({
      where: { key },
      select: { encryptedValue: true },
    });
    if (!row?.encryptedValue) {
      return null;
    }
    const value = decryptV1(row.encryptedValue);
    return value.trim() ? value : null;
  } catch {
    return null;
  }
}

/**
 * Build a `BillingProviderAdapter` for a `ProviderInstance` row.
 *
 * - `pymthouse`: parse config + resolve the M2M secret, then bind a
 *   per-instance `PmtHouseClient` (so multiple pymthouse apps coexist).
 *   Returns undefined when config is incomplete or the secret cannot resolve,
 *   so the registry can fall back to the global-env default adapter.
 * - other adapterTypes: config-free in P0; the registry uses its default
 *   factory for those, so this returns undefined here.
 */
export async function buildAdapterForProviderInstance(
  instance: ProviderInstanceRecord,
): Promise<BillingProviderAdapter | undefined> {
  if (instance.adapterType === PYMTHOUSE_ADAPTER_SLUG) {
    const config = parsePymthouseInstanceConfig(instance.config);
    if (!config || !instance.secretRef) {
      return undefined;
    }
    const m2mClientSecret = await getProviderInstanceSecret(instance.secretRef);
    if (!m2mClientSecret) {
      return undefined;
    }
    const client = createPmtHouseClient({ ...config, m2mClientSecret });
    return new PymthouseAdapter({
      client,
      isConfigured: () => true,
      // Per-instance signer-session exchange binds to THIS app's issuer/creds so
      // the opaque `pmth_…` mint targets the right token endpoint (not global env).
      signerExchange: {
        issuerUrl: config.issuerUrl,
        m2mClientId: config.m2mClientId,
        m2mClientSecret,
        ...(config.allowInsecureHttp !== undefined
          ? { allowInsecureHttp: config.allowInsecureHttp }
          : {}),
      },
    });
  }
  return undefined;
}
