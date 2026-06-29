/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  featureFlag: { findUnique: vi.fn() },
  featureFlagOverride: { findMany: vi.fn(), findFirst: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma }));

import {
  isFeatureEnabled,
  isFeatureEnabledForTeam,
  anyTeamFlagOverrideEnabled,
  resetFeatureFlagOverrideCache,
} from './feature-flags';

const FLAG = 'capability_gate'; // KNOWN_FLAGS default: false
const TEAM = 'team-1';

beforeEach(() => {
  vi.clearAllMocks();
  resetFeatureFlagOverrideCache();
  // Default: no overrides anywhere.
  prisma.featureFlagOverride.findMany.mockResolvedValue([]);
  prisma.featureFlagOverride.findFirst.mockResolvedValue(null);
  prisma.featureFlag.findUnique.mockResolvedValue(null);
});

describe('isFeatureEnabled — global (no team context) is unchanged', () => {
  it('returns the global DB value when the flag row exists', async () => {
    prisma.featureFlag.findUnique.mockResolvedValue({ enabled: true });
    expect(await isFeatureEnabled(FLAG)).toBe(true);
    // No override lookup happens without a team context.
    expect(prisma.featureFlagOverride.findMany).not.toHaveBeenCalled();
  });

  it('falls back to the KNOWN_FLAGS default when the row is absent', async () => {
    prisma.featureFlag.findUnique.mockResolvedValue(null);
    expect(await isFeatureEnabled(FLAG)).toBe(false); // capability_gate default OFF
    expect(await isFeatureEnabled('enableTeams')).toBe(true); // default ON
  });

  it('unknown flag with no row → false', async () => {
    expect(await isFeatureEnabled('does_not_exist')).toBe(false);
  });

  it('DB error → static default (safe no-op)', async () => {
    prisma.featureFlag.findUnique.mockRejectedValue(new Error('db down'));
    expect(await isFeatureEnabled(FLAG)).toBe(false);
  });
});

describe('isFeatureEnabled — per-team override precedence', () => {
  it('override ON wins over a global OFF', async () => {
    prisma.featureFlag.findUnique.mockResolvedValue({ enabled: false });
    prisma.featureFlagOverride.findMany.mockResolvedValue([{ flagKey: FLAG, enabled: true }]);
    expect(await isFeatureEnabled(FLAG, TEAM)).toBe(true);
  });

  it('override OFF wins over a global ON', async () => {
    prisma.featureFlag.findUnique.mockResolvedValue({ enabled: true });
    prisma.featureFlagOverride.findMany.mockResolvedValue([{ flagKey: FLAG, enabled: false }]);
    expect(await isFeatureEnabled(FLAG, TEAM)).toBe(false);
  });

  it('no override for the key → inherits the global value (cleared = inherit)', async () => {
    prisma.featureFlag.findUnique.mockResolvedValue({ enabled: true });
    prisma.featureFlagOverride.findMany.mockResolvedValue([
      { flagKey: 'some_other_flag', enabled: true },
    ]);
    expect(await isFeatureEnabled(FLAG, TEAM)).toBe(true);
  });

  it('ZERO REGRESSION: no override rows → byte-identical to the global value', async () => {
    prisma.featureFlag.findUnique.mockResolvedValue({ enabled: false });
    prisma.featureFlagOverride.findMany.mockResolvedValue([]);
    const globalValue = await isFeatureEnabled(FLAG);
    const teamValue = await isFeatureEnabled(FLAG, TEAM);
    expect(teamValue).toBe(globalValue);
    expect(teamValue).toBe(false);
  });

  it('override lookup failure degrades to the global value (fail-safe)', async () => {
    prisma.featureFlag.findUnique.mockResolvedValue({ enabled: true });
    prisma.featureFlagOverride.findMany.mockRejectedValue(new Error('db down'));
    expect(await isFeatureEnabled(FLAG, TEAM)).toBe(true);
  });

  it('cross-team isolation: team B is unaffected by team A\'s override', async () => {
    prisma.featureFlag.findUnique.mockResolvedValue({ enabled: false });
    prisma.featureFlagOverride.findMany.mockImplementation(async ({ where }: { where: { teamId: string } }) =>
      where.teamId === 'team-A' ? [{ flagKey: FLAG, enabled: true }] : [],
    );
    expect(await isFeatureEnabled(FLAG, 'team-A')).toBe(true);
    expect(await isFeatureEnabled(FLAG, 'team-B')).toBe(false);
  });

  it('isFeatureEnabledForTeam is an alias for the team-scoped path', async () => {
    prisma.featureFlag.findUnique.mockResolvedValue({ enabled: false });
    prisma.featureFlagOverride.findMany.mockResolvedValue([{ flagKey: FLAG, enabled: true }]);
    expect(await isFeatureEnabledForTeam(FLAG, TEAM)).toBe(true);
  });
});

describe('per-request cache (no N+1 on the hot path)', () => {
  it('loads a team\'s overrides with ONE findMany for multiple flag checks', async () => {
    prisma.featureFlagOverride.findMany.mockResolvedValue([
      { flagKey: 'capability_gate', enabled: true },
      { flagKey: 'key_validation_front_door', enabled: true },
    ]);
    await isFeatureEnabled('capability_gate', TEAM);
    await isFeatureEnabled('key_validation_front_door', TEAM);
    await isFeatureEnabled('per_key_remote_signer', TEAM);
    expect(prisma.featureFlagOverride.findMany).toHaveBeenCalledTimes(1);
  });

  it('resetFeatureFlagOverrideCache forces a fresh load', async () => {
    await isFeatureEnabled(FLAG, TEAM);
    resetFeatureFlagOverrideCache();
    await isFeatureEnabled(FLAG, TEAM);
    expect(prisma.featureFlagOverride.findMany).toHaveBeenCalledTimes(2);
  });
});

describe('anyTeamFlagOverrideEnabled — front-door visibility helper', () => {
  it('true when at least one team has the flag overridden ON', async () => {
    prisma.featureFlagOverride.findFirst.mockResolvedValue({ id: 'o1' });
    expect(await anyTeamFlagOverrideEnabled('key_validation_front_door')).toBe(true);
  });

  it('false when no team has it overridden ON', async () => {
    prisma.featureFlagOverride.findFirst.mockResolvedValue(null);
    expect(await anyTeamFlagOverrideEnabled('key_validation_front_door')).toBe(false);
  });

  it('DB error → false (stay hidden, exactly as today)', async () => {
    prisma.featureFlagOverride.findFirst.mockRejectedValue(new Error('db down'));
    expect(await anyTeamFlagOverrideEnabled('key_validation_front_door')).toBe(false);
  });
});
