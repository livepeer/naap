/**
 * Teams Service for Next.js API Routes
 *
 * Handles team/organization management.
 */

import { prisma } from '../db';
import { ADMIN_TEAM_ACCESS_FLAG, isFeatureEnabled } from '../feature-flags';

export type TeamRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface TeamMember {
  id: string;
  userId: string;
  role: TeamRole;
  user: {
    id: string;
    email: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
  joinedAt: Date;
}

export interface Team {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  avatarUrl: string | null;
  ownerId: string;
  createdAt: Date;
  _count?: {
    members: number;
  };
}

// Role hierarchy for permission checks
const ROLE_HIERARCHY: Record<TeamRole, number> = {
  viewer: 1,
  member: 2,
  admin: 3,
  owner: 4,
};

/**
 * Check if a role has permission to perform an action
 */
export function hasRolePermission(
  userRole: TeamRole,
  requiredRole: TeamRole
): boolean {
  return ROLE_HIERARCHY[userRole] >= ROLE_HIERARCHY[requiredRole];
}

/**
 * Get role permissions description
 */
export function getRolePermissions(): Record<TeamRole, string[]> {
  return {
    owner: [
      'All admin permissions',
      'Delete team',
      'Transfer ownership',
      'Manage billing',
    ],
    admin: [
      'All member permissions',
      'Invite/remove members',
      'Change member roles',
      'Install/uninstall plugins',
      'Configure team plugins',
      'Update team settings',
    ],
    member: [
      'All viewer permissions',
      'Use team plugins',
      'Update personal config',
    ],
    viewer: [
      'View team dashboard',
      'View team plugins',
      'View team members',
    ],
  };
}

/**
 * Create a new team
 */
export async function createTeam(
  userId: string,
  data: {
    name: string;
    slug: string;
    description?: string;
    avatarUrl?: string;
  }
): Promise<Team> {
  // Validate slug format
  if (!/^[a-z0-9-]+$/.test(data.slug)) {
    throw new Error('Slug must contain only lowercase letters, numbers, and hyphens');
  }

  // Check if slug is taken
  const existing = await prisma.team.findUnique({
    where: { slug: data.slug },
  });

  if (existing) {
    throw new Error('Team slug is already taken');
  }

  // Create team with owner membership
  const team = await prisma.team.create({
    data: {
      name: data.name,
      slug: data.slug,
      description: data.description,
      avatarUrl: data.avatarUrl,
      ownerId: userId,
      members: {
        create: {
          userId,
          role: 'owner',
        },
      },
    },
    include: {
      _count: {
        select: { members: true },
      },
    },
  });

  return team as Team;
}

/**
 * Get user's teams
 */
export async function getUserTeams(userId: string): Promise<Team[]> {
  const memberships = await prisma.teamMember.findMany({
    where: { userId },
    include: {
      team: {
        include: {
          _count: {
            select: { 
              members: true,
              pluginInstalls: true,
            },
          },
        },
      },
    },
    orderBy: { joinedAt: 'desc' },
  });

  return memberships.map(m => ({
    ...m.team,
    membership: { role: m.role },
  })) as Team[];
}

/**
 * Get team by ID
 */
export async function getTeam(teamId: string): Promise<Team | null> {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      _count: {
        select: { members: true },
      },
    },
  });

  return team as Team | null;
}

/**
 * Get team by slug
 */
export async function getTeamBySlug(slug: string): Promise<Team | null> {
  const team = await prisma.team.findUnique({
    where: { slug },
    include: {
      _count: {
        select: { members: true },
      },
    },
  });

  return team as Team | null;
}

/**
 * Get team member
 */
export async function getTeamMember(
  teamId: string,
  userId: string
): Promise<TeamMember | null> {
  const member = await prisma.teamMember.findUnique({
    where: {
      teamId_userId: { teamId, userId },
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          displayName: true,
          avatarUrl: true,
        },
      },
    },
  });

  return member as TeamMember | null;
}

/**
 * Update team
 */
export async function updateTeam(
  teamId: string,
  data: {
    name?: string;
    description?: string;
    avatarUrl?: string;
  },
  userId: string
): Promise<Team> {
  // Check permission
  const member = await getTeamMember(teamId, userId);
  if (!member || !hasRolePermission(member.role as TeamRole, 'admin')) {
    throw new Error('Only admins can update team settings');
  }

  const team = await prisma.team.update({
    where: { id: teamId },
    data: {
      name: data.name,
      description: data.description,
      avatarUrl: data.avatarUrl,
    },
    include: {
      _count: {
        select: { members: true },
      },
    },
  });

  return team as Team;
}

/**
 * Delete team
 */
export async function deleteTeam(teamId: string, userId: string): Promise<void> {
  const team = await getTeam(teamId);
  if (!team) {
    throw new Error('Team not found');
  }

  if (team.ownerId !== userId) {
    throw new Error('Only the owner can delete the team');
  }

  await prisma.team.delete({
    where: { id: teamId },
  });
}

/**
 * List team members
 */
export async function listMembers(
  teamId: string,
  options?: { skip?: number; take?: number }
): Promise<TeamMember[]> {
  const members = await prisma.teamMember.findMany({
    where: { teamId },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          displayName: true,
          avatarUrl: true,
        },
      },
    },
    skip: options?.skip,
    take: options?.take,
    orderBy: { joinedAt: 'asc' },
  });

  return members as TeamMember[];
}

/**
 * Create a team membership row from an email + role.
 *
 * Shared, authorization-agnostic core reused by BOTH the team-admin
 * {@link inviteMember} flow and the platform-admin {@link adminAddMember} flow so
 * the resulting `TeamMember` row is byte-identical regardless of the authorization
 * source. Enforces every membership invariant EXCEPT who is allowed to perform it
 * (the caller is responsible for authorization): no `owner` role via this path,
 * the target user must already exist, and they must not already be a member. The
 * `invitedBy` column records the acting user for provenance/audit either way.
 */
async function createMembershipByEmail(
  teamId: string,
  data: { email: string; role: TeamRole },
  invitedBy: string
): Promise<TeamMember> {
  // Cannot add as owner (owner is assigned at creation / via transferOwnership).
  if (data.role === 'owner') {
    throw new Error('Cannot invite someone as owner');
  }

  // Find user by email
  const user = await prisma.user.findUnique({
    where: { email: data.email },
  });

  if (!user) {
    throw new Error('User not found. They must register first.');
  }

  // Check if already a member
  const existing = await getTeamMember(teamId, user.id);
  if (existing) {
    throw new Error('User is already a member of this team');
  }

  // Create membership
  const member = await prisma.teamMember.create({
    data: {
      teamId,
      userId: user.id,
      role: data.role,
      invitedBy,
    },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          displayName: true,
          avatarUrl: true,
        },
      },
    },
  });

  return member as TeamMember;
}

/**
 * Invite member to team (team-admin authorized).
 *
 * Authorization: the inviter must be a team `admin` or higher. The membership row
 * itself is created by the shared {@link createMembershipByEmail} core.
 */
export async function inviteMember(
  teamId: string,
  data: { email: string; role: TeamRole },
  invitedBy: string
): Promise<TeamMember> {
  // Check permission
  const inviter = await getTeamMember(teamId, invitedBy);
  if (!inviter || !hasRolePermission(inviter.role as TeamRole, 'admin')) {
    throw new Error('Only admins can invite members');
  }

  return createMembershipByEmail(teamId, data, invitedBy);
}

/**
 * Add a team member as a PLATFORM ADMIN (`system:admin`), bypassing the
 * team-admin membership requirement.
 *
 * This is the sole authorization difference vs {@link inviteMember}: the acting
 * user is authorized by `system:admin` (enforced at the route) rather than by an
 * existing team-admin membership. It reuses the exact same {@link createMembershipByEmail}
 * core, so the created `TeamMember` row is identical (same schema, enums, and
 * `invitedBy` provenance) — no other invariant is bypassed. Callers MUST gate
 * this behind the `admin_team_access` flag and write an audit record.
 */
export async function adminAddMember(
  teamId: string,
  data: { email: string; role: TeamRole },
  adminUserId: string
): Promise<TeamMember> {
  return createMembershipByEmail(teamId, data, adminUserId);
}

/**
 * Update member role
 */
export async function updateMemberRole(
  memberId: string,
  newRole: TeamRole,
  updatedBy: string
): Promise<TeamMember> {
  const member = await prisma.teamMember.findUnique({
    where: { id: memberId },
    include: { team: true },
  });

  if (!member) {
    throw new Error('Member not found');
  }

  // Check permission
  const updater = await getTeamMember(member.teamId, updatedBy);
  if (!updater || !hasRolePermission(updater.role as TeamRole, 'admin')) {
    throw new Error('Only admins can update member roles');
  }

  // Cannot change owner role
  if (member.role === 'owner') {
    throw new Error('Cannot change owner role. Use transfer ownership instead.');
  }

  // Cannot promote to owner
  if (newRole === 'owner') {
    throw new Error('Cannot promote to owner. Use transfer ownership instead.');
  }

  const updated = await prisma.teamMember.update({
    where: { id: memberId },
    data: { role: newRole },
    include: {
      user: {
        select: {
          id: true,
          email: true,
          displayName: true,
          avatarUrl: true,
        },
      },
    },
  });

  return updated as TeamMember;
}

/**
 * Remove member from team
 */
export async function removeMember(
  memberId: string,
  removedBy: string
): Promise<void> {
  const member = await prisma.teamMember.findUnique({
    where: { id: memberId },
  });

  if (!member) {
    throw new Error('Member not found');
  }

  // Check permission
  const remover = await getTeamMember(member.teamId, removedBy);
  if (!remover || !hasRolePermission(remover.role as TeamRole, 'admin')) {
    throw new Error('Only admins can remove members');
  }

  // Cannot remove owner
  if (member.role === 'owner') {
    throw new Error('Cannot remove the owner');
  }

  await prisma.teamMember.delete({
    where: { id: memberId },
  });
}

/**
 * Transfer ownership
 */
export async function transferOwnership(
  teamId: string,
  newOwnerId: string,
  currentOwnerId: string
): Promise<void> {
  const team = await getTeam(teamId);
  if (!team) {
    throw new Error('Team not found');
  }

  if (team.ownerId !== currentOwnerId) {
    throw new Error('Only the current owner can transfer ownership');
  }

  // Check if new owner is a member
  const newOwnerMember = await getTeamMember(teamId, newOwnerId);
  if (!newOwnerMember) {
    throw new Error('New owner must be a team member');
  }

  // Transfer ownership in a transaction
  await prisma.$transaction([
    // Update team owner
    prisma.team.update({
      where: { id: teamId },
      data: { ownerId: newOwnerId },
    }),
    // Update old owner to admin
    prisma.teamMember.update({
      where: {
        teamId_userId: { teamId, userId: currentOwnerId },
      },
      data: { role: 'admin' },
    }),
    // Update new owner role
    prisma.teamMember.update({
      where: {
        teamId_userId: { teamId, userId: newOwnerId },
      },
      data: { role: 'owner' },
    }),
  ]);
}

/**
 * Options for {@link validateTeamAccess}. Purely additive: when omitted, access
 * resolution is byte-identical to the legacy member-only behavior.
 */
export interface TeamAccessOptions {
  /**
   * Roles of the ACTING session user (e.g. `user.roles`). When it includes
   * `system:admin` AND the `admin_team_access` flag is enabled for this team, a
   * platform admin who is not a team member — or who is a member without the
   * required role — is granted access (audited). Omitted or without
   * `system:admin` ⇒ the flag is never read and behavior is unchanged.
   */
  actorRoles?: string[];
}

/**
 * Best-effort audit row for a platform-admin team-access grant. Never blocks or
 * fails the access check (mirrors other admin-mutation audit writes).
 */
async function auditAdminTeamAccess(
  userId: string,
  teamId: string,
  requiredRole: TeamRole,
  wasMember: boolean
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action: 'admin_team_access.grant',
        resource: 'team',
        resourceId: teamId,
        userId,
        details: { requiredRole, wasMember, via: ADMIN_TEAM_ACCESS_FLAG },
        status: 'success',
      },
    });
  } catch (err) {
    console.error('[admin_team_access] audit write failed:', err);
  }
}

/**
 * Resolve whether the flag-gated `system:admin` allowance applies. Returns
 * `false` SYNCHRONOUSLY (no DB/flag read) unless the caller opted in with
 * `actorRoles` containing `system:admin`, so callers that pass no options — i.e.
 * every existing call site — see byte-identical behavior with zero extra I/O.
 */
async function adminAccessAllowed(
  teamId: string,
  options: TeamAccessOptions | undefined
): Promise<boolean> {
  if (!options?.actorRoles?.includes('system:admin')) return false;
  return isFeatureEnabled(ADMIN_TEAM_ACCESS_FLAG, teamId);
}

/** A synthetic in-memory member record for a non-member platform admin. */
function syntheticAdminMember(userId: string, teamId: string): TeamMember {
  return {
    id: `admin:${teamId}:${userId}`,
    userId,
    role: 'admin',
    user: { id: userId, email: null, displayName: null, avatarUrl: null },
    joinedAt: new Date(0),
  };
}

/**
 * Validate team context middleware helper.
 *
 * Default (no `options`): the caller must be a team member with at least
 * `requiredRole`, exactly as today. When `options.actorRoles` includes
 * `system:admin` and the `admin_team_access` flag is ON for this team, a
 * platform admin is additionally allowed through (and the grant is audited).
 * This allowance is additive and flag-gated, so with the flag OFF — or with no
 * `options` — behavior is byte-identical to the legacy member-only path.
 */
export async function validateTeamAccess(
  userId: string,
  teamId: string,
  requiredRole: TeamRole = 'viewer',
  options?: TeamAccessOptions
): Promise<{ team: Team; member: TeamMember }> {
  const team = await getTeam(teamId);
  if (!team) {
    throw new Error('Team not found');
  }

  const member = await getTeamMember(teamId, userId);
  if (!member) {
    if (await adminAccessAllowed(teamId, options)) {
      await auditAdminTeamAccess(userId, teamId, requiredRole, false);
      return { team, member: syntheticAdminMember(userId, teamId) };
    }
    throw new Error('Not a member of this team');
  }

  if (!hasRolePermission(member.role as TeamRole, requiredRole)) {
    if (await adminAccessAllowed(teamId, options)) {
      await auditAdminTeamAccess(userId, teamId, requiredRole, true);
      return { team, member };
    }
    throw new Error(`Requires ${requiredRole} role or higher`);
  }

  return { team, member };
}
