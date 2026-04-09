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
];

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
