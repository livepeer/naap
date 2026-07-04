/** @vitest-environment node */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const prisma = vi.hoisted(() => ({
  team: { findUnique: vi.fn() },
  teamMember: { findUnique: vi.fn(), create: vi.fn() },
  user: { findUnique: vi.fn() },
  auditLog: { create: vi.fn() },
  featureFlag: { findUnique: vi.fn() },
  featureFlagOverride: { findMany: vi.fn(), findFirst: vi.fn() },
}));
vi.mock('@/lib/db', () => ({ prisma }));

import { adminAddMember, validateTeamAccess } from '../teams';
import { resetFeatureFlagOverrideCache } from '../../feature-flags';

const TEAM = 'team-1';
const ADMIN_USER = 'admin-user';
const TEAM_OBJ = { id: TEAM, name: 'Acme', slug: 'acme' };

/** Enable/disable the admin_team_access flag for TEAM via a per-team override. */
function setFlag(enabled: boolean): void {
  prisma.featureFlagOverride.findMany.mockResolvedValue(
    enabled ? [{ flagKey: 'admin_team_access', enabled: true }] : [],
  );
}

function memberRow(userId: string, role: string) {
  return {
    id: `m-${userId}`,
    userId,
    role,
    user: { id: userId, email: `${userId}@x.io`, displayName: null, avatarUrl: null },
    joinedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetFeatureFlagOverrideCache();
  prisma.team.findUnique.mockResolvedValue(TEAM_OBJ);
  prisma.teamMember.findUnique.mockResolvedValue(null);
  prisma.featureFlag.findUnique.mockResolvedValue(null); // no global row → KNOWN default (OFF)
  prisma.featureFlagOverride.findMany.mockResolvedValue([]);
  prisma.featureFlagOverride.findFirst.mockResolvedValue(null);
});

describe('validateTeamAccess — legacy behavior is unchanged (no options)', () => {
  it('returns the member when they have the required role', async () => {
    prisma.teamMember.findUnique.mockResolvedValue(memberRow('u1', 'admin'));
    const { team, member } = await validateTeamAccess('u1', TEAM, 'admin');
    expect(team.id).toBe(TEAM);
    expect(member.role).toBe('admin');
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('throws "Not a member" for a non-member with no options', async () => {
    await expect(validateTeamAccess('nobody', TEAM, 'viewer')).rejects.toThrow('Not a member');
    // No flag lookup and no audit on the legacy path.
    expect(prisma.featureFlagOverride.findMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('throws "Requires <role>" for an under-privileged member with no options', async () => {
    prisma.teamMember.findUnique.mockResolvedValue(memberRow('u1', 'viewer'));
    await expect(validateTeamAccess('u1', TEAM, 'admin')).rejects.toThrow('Requires admin role or higher');
  });
});

describe('validateTeamAccess — flag-gated system:admin allowance', () => {
  it('flag OFF: a system:admin non-member is still blocked (byte-identical) and NOT audited', async () => {
    setFlag(false);
    await expect(
      validateTeamAccess(ADMIN_USER, TEAM, 'viewer', { actorRoles: ['system:admin'] }),
    ).rejects.toThrow('Not a member');
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('flag ON: a system:admin non-member is granted a synthetic admin member (audited)', async () => {
    setFlag(true);
    const { team, member } = await validateTeamAccess(ADMIN_USER, TEAM, 'admin', {
      actorRoles: ['system:admin'],
    });
    expect(team.id).toBe(TEAM);
    expect(member.role).toBe('admin');
    expect(member.userId).toBe(ADMIN_USER);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    const auditArg = prisma.auditLog.create.mock.calls[0][0].data;
    expect(auditArg.action).toBe('admin_team_access.grant');
    expect(auditArg.resourceId).toBe(TEAM);
    expect(auditArg.details).toMatchObject({ wasMember: false });
  });

  it('flag ON: an under-privileged member who is also system:admin passes through (audited, real member)', async () => {
    setFlag(true);
    prisma.teamMember.findUnique.mockResolvedValue(memberRow(ADMIN_USER, 'viewer'));
    const { member } = await validateTeamAccess(ADMIN_USER, TEAM, 'admin', {
      actorRoles: ['system:admin'],
    });
    expect(member.role).toBe('viewer'); // the real membership row, not synthetic
    const auditArg = prisma.auditLog.create.mock.calls[0][0].data;
    expect(auditArg.details).toMatchObject({ wasMember: true });
  });

  it('flag ON but actor is NOT system:admin: no allowance, no flag read', async () => {
    setFlag(true);
    await expect(
      validateTeamAccess('u2', TEAM, 'viewer', { actorRoles: ['user'] }),
    ).rejects.toThrow('Not a member');
    expect(prisma.featureFlagOverride.findMany).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('audit failure never breaks the grant (best-effort)', async () => {
    setFlag(true);
    prisma.auditLog.create.mockRejectedValue(new Error('db down'));
    const { member } = await validateTeamAccess(ADMIN_USER, TEAM, 'viewer', {
      actorRoles: ['system:admin'],
    });
    expect(member.userId).toBe(ADMIN_USER);
  });
});

describe('adminAddMember — identical row shape to inviteMember', () => {
  it('creates a TeamMember row with the exact same shape, recording the admin as invitedBy', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'target-1', email: 'new@x.io' });
    prisma.teamMember.findUnique.mockResolvedValue(null); // not yet a member
    prisma.teamMember.create.mockResolvedValue(memberRow('target-1', 'member'));

    await adminAddMember(TEAM, { email: 'new@x.io', role: 'member' }, ADMIN_USER);

    expect(prisma.teamMember.create).toHaveBeenCalledTimes(1);
    const createArg = prisma.teamMember.create.mock.calls[0][0];
    expect(createArg.data).toEqual({
      teamId: TEAM,
      userId: 'target-1',
      role: 'member',
      invitedBy: ADMIN_USER,
    });
    // Same include projection as inviteMember (identical returned shape).
    expect(createArg.include).toEqual({
      user: { select: { id: true, email: true, displayName: true, avatarUrl: true } },
    });
  });

  it('preserves invariants: cannot add as owner', async () => {
    await expect(
      adminAddMember(TEAM, { email: 'new@x.io', role: 'owner' }, ADMIN_USER),
    ).rejects.toThrow('Cannot invite someone as owner');
    expect(prisma.teamMember.create).not.toHaveBeenCalled();
  });

  it('preserves invariants: target user must exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(
      adminAddMember(TEAM, { email: 'ghost@x.io', role: 'member' }, ADMIN_USER),
    ).rejects.toThrow('User not found');
  });

  it('preserves invariants: cannot add an existing member', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 'target-1', email: 'new@x.io' });
    prisma.teamMember.findUnique.mockResolvedValue(memberRow('target-1', 'member'));
    await expect(
      adminAddMember(TEAM, { email: 'new@x.io', role: 'member' }, ADMIN_USER),
    ).rejects.toThrow('already a member');
  });
});
