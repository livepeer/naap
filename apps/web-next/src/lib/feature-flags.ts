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
