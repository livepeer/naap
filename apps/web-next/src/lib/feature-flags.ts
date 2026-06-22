/**
 * Known feature flags and their defaults.
 *
 * To add a new feature flag, append an entry here. It will:
 *  - Auto-create in the database on first API access (no re-seed required)
 *  - Appear on the admin Settings page automatically
 *  - Be available via useFeatureFlags() hook as flags.<key>
 */

import { prisma } from '@/lib/db';

export interface KnownFlag {
  key: string;
  enabled: boolean;
  description: string;
}

/**
 * Canonical key for the NAAP-5 flag (default OFF). Single source of truth shared
 * by the KNOWN_FLAGS registry and the gateway authorize step so the flag name
 * cannot silently drift between the two.
 */
export const SDK_CONNECTOR_FLAG = 'sdk_connector';

/**
 * Canonical key for the pymthouse BPP ② live capability-resolution flag (default
 * OFF). When OFF, `PymthouseAdapter.validate()` throws `AdapterNotImplementedError`
 * exactly as before, so the front door falls back to an empty capability set
 * (today's behavior). Shared by KNOWN_FLAGS and the adapter so the name cannot
 * drift. Requires the provider's `BPP_VALIDATE_V2` posture in the same env.
 */
export const PYMTHOUSE_BPP_VALIDATE_FLAG = 'pymthouse_bpp_validate';

export const KNOWN_FLAGS: KnownFlag[] = [
  {
    key: 'enableTeams',
    enabled: true,
    description: 'Enable teams collaboration feature (team creation, team switching, team pages)',
  },
  {
    key: 'provider_adapters',
    enabled: false,
    description:
      'Route billing requests through the generic BillingProviderAdapter registry (/api/v1/billing/{provider}/*). OFF = legacy /billing/pymthouse/* behavior only.',
  },
  {
    key: 'team_seats',
    enabled: false,
    description:
      'Team Seats API + provider-agnostic billingAccountRef binding (/api/v1/teams/{id}/seats/*, /billing-account). OFF = endpoints 404, no-op (NAAP-1).',
  },
  {
    key: 'usage_ingest',
    enabled: false,
    description:
      'Enable cross-provider usage telemetry: the BPP ⑥ ingest endpoint (/api/v1/metrics/ingest) and the spend dashboard BFF (/api/v1/metrics/usage). OFF = both return 404 (no-op).',
  },
  {
    key: 'usage_pull',
    enabled: false,
    description:
      'Spend dashboard PULLS provider usage live via the provider adapter (e.g. pymthouse M2M client) instead of reading pushed ProviderUsageRecord rows. OFF = reads ProviderUsageRecord exactly as today. ON = pull-first with graceful fallback to ProviderUsageRecord on any pull failure (never 500). Tenant scoping is preserved either way (NAAP-2).',
  },
  {
    key: 'app_registry',
    enabled: false,
    description:
      'Enable the application/service registry (/api/v1/apps/*) so usage and rate limits attribute per registered app. OFF = registry endpoints return 404 (no-op).',
  },
  {
    key: 'db_adapter_registry',
    enabled: false,
    description:
      'Resolve the BillingProviderAdapter from the BillingProvider.adapterType DB column (NAAP-A-db) instead of the static slug→adapter map. OFF = static registry (zero regression); falls back to static on any DB miss/error.',
  },
  {
    key: 'native_keys',
    enabled: false,
    description:
      'Native provider-opaque naap_ keys issued to a seat (/api/v1/teams/{id}/seats/{seatId}/keys). OFF = endpoints 404, no-op (NAAP-B).',
  },
  {
    key: 'key_validation_front_door',
    enabled: false,
    description:
      'Key validation front door POST /api/v1/keys/validate (resolves naap_ → provider via adapter, BPP ③). OFF = 404 so callers fall back to their direct path (NAAP-C).',
  },
  {
    key: 'capability_gate',
    enabled: false,
    description:
      'Enforce key → plan → capability access at the front door and discovery (NAAP-E). OFF = no enforcement (capabilities surfaced only, exactly as today); ON = deny a requested capability not granted by the resolved plan (fail closed).',
  },
  {
    key: SDK_CONNECTOR_FLAG,
    enabled: false,
    description:
      'Seed the public "sdk" Service Gateway connector (fronting sdk.daydream.monster at /api/v1/gw/sdk/*) AND accept native naap_ keys at the gateway authorize step (NAAP-5). OFF = no sdk connector seeded and naap_ keys are rejected at the gateway exactly as today (no-op).',
  },
  {
    key: PYMTHOUSE_BPP_VALIDATE_FLAG,
    enabled: false,
    description:
      'Resolve a validated key\'s capabilities LIVE from the pymthouse provider (BPP ②) via the M2M client, keyed on the account\'s externalUserId, and surface them at the validation front door. OFF = PymthouseAdapter.validate() is unimplemented (front door falls back to an empty capability set, exactly as today). Requires the provider\'s BPP_VALIDATE_V2 posture in the same environment; pairs with capability_gate (also default OFF).',
  },
];

/**
 * Read a single feature flag's effective state without writing to the DB.
 * Falls back to the KNOWN_FLAGS default (or `false`) when the flag row does not
 * exist yet, so a flag defaulting OFF is a no-op until an admin enables it.
 */
export async function isFeatureEnabled(key: string): Promise<boolean> {
  try {
    const flag = await prisma.featureFlag.findUnique({
      where: { key },
      select: { enabled: true },
    });
    if (flag) return flag.enabled;
  } catch {
    // Transient DB lookup failures must not break callers: fall through to the
    // static KNOWN_FLAGS default so a flag defaulting OFF stays a safe no-op.
  }
  return KNOWN_FLAGS.find((f) => f.key === key)?.enabled ?? false;
}

/**
 * Ensure all known flags exist in the database.
 * Uses upsert with no-op update so existing flags (and admin overrides) are preserved.
 */
export async function ensureKnownFlags(): Promise<void> {
  await Promise.all(
    KNOWN_FLAGS.map(flag =>
      prisma.featureFlag.upsert({
        where: { key: flag.key },
        update: {},
        create: {
          key: flag.key,
          enabled: flag.enabled,
          description: flag.description,
        },
      })
    )
  );
}
