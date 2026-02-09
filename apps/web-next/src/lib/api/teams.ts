/**
 * Teams Service for Next.js API Routes
 *
 * Handles team/organization management.
 */

import { prisma } from '../db';

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
 * Invite member to team
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

  // Cannot invite as owner
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
 * Validate team context middleware helper
 */
export async function validateTeamAccess(
  userId: string,
  teamId: string,
  requiredRole: TeamRole = 'viewer'
): Promise<{ team: Team; member: TeamMember }> {
  const team = await getTeam(teamId);
  if (!team) {
    throw new Error('Team not found');
  }

  const member = await getTeamMember(teamId, userId);
  if (!member) {
    throw new Error('Not a member of this team');
  }

  if (!hasRolePermission(member.role as TeamRole, requiredRole)) {
    throw new Error(`Requires ${requiredRole} role or higher`);
  }

  return { team, member };
}
