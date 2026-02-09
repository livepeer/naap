/**
 * Team Service
 * 
 * Manages teams/organizations: CRUD operations and member management.
 * Provides audit logging for all team operations.
 */

import { PrismaClient, Team, TeamMember } from '@naap/database';
import { createLifecycleService } from './lifecycle';
import { createDeploymentService } from './deployment';

export type TeamRole = 'owner' | 'admin' | 'member' | 'viewer';

export interface CreateTeamInput {
  name: string;
  slug: string;
  description?: string;
  avatarUrl?: string;
}

export interface UpdateTeamInput {
  name?: string;
  description?: string;
  avatarUrl?: string;
}

export interface InviteMemberInput {
  email: string;
  role: TeamRole;
}

export interface TeamWithMembers extends Team {
  members: (TeamMember & {
    user: {
      id: string;
      email: string | null;
      displayName: string | null;
      avatarUrl: string | null;
    };
  })[];
  _count: {
    members: number;
    pluginInstalls: number;
  };
}

export interface TeamMemberWithUser extends TeamMember {
  user: {
    id: string;
    email: string | null;
    displayName: string | null;
    avatarUrl: string | null;
  };
  team: {
    id: string;
    name: string;
    slug: string;
  };
}

// Permission levels for team roles
const ROLE_PERMISSIONS: Record<TeamRole, string[]> = {
  owner: ['team.manage', 'team.delete', 'members.manage', 'members.invite', 'plugins.install', 'plugins.uninstall', 'plugins.configure', 'access.manage'],
  admin: ['members.manage', 'members.invite', 'plugins.configure', 'access.manage'],
  member: ['plugins.use', 'plugins.configure.personal'],
  viewer: ['plugins.view'],
};

export function createTeamService(prisma: PrismaClient) {
  const lifecycleService = createLifecycleService(prisma);
  const deploymentService = createDeploymentService(prisma);

  return {
    /**
     * Create a new team
     * The creating user automatically becomes the owner
     * Core plugins are auto-installed for new teams
     */
    async createTeam(ownerId: string, input: CreateTeamInput): Promise<Team> {
      // Check slug uniqueness
      const existing = await prisma.team.findUnique({
        where: { slug: input.slug },
      });
      if (existing) {
        throw new Error('Team slug already exists');
      }

      // Create team, owner membership, and install core plugins in a transaction
      const team = await prisma.$transaction(async (tx) => {
        const newTeam = await tx.team.create({
          data: {
            name: input.name,
            slug: input.slug,
            description: input.description,
            avatarUrl: input.avatarUrl,
            ownerId,
          },
        });

        // Add owner as a team member with 'owner' role
        const ownerMember = await tx.teamMember.create({
          data: {
            teamId: newTeam.id,
            userId: ownerId,
            role: 'owner',
            invitedBy: ownerId,
          },
        });

        // Auto-install core plugins for the new team
        const corePackages = await tx.pluginPackage.findMany({
          where: { isCore: true },
          include: {
            versions: {
              orderBy: { publishedAt: 'desc' },
              take: 1,
            },
          },
        });

        for (const pkg of corePackages) {
          const latestVersion = pkg.versions[0];
          if (!latestVersion) continue;

          // Get or create deployment for this package
          // Note: We use the main prisma client for deployment since it may need to create records
          const { deployment } = await deploymentService.getOrCreateDeployment(pkg.id, latestVersion.id);

          // Check if already installed (shouldn't happen for new team, but be safe)
          const existingInstall = await tx.teamPluginInstall.findUnique({
            where: { teamId_deploymentId: { teamId: newTeam.id, deploymentId: deployment.id } },
          });

          if (!existingInstall) {
            // Create team plugin installation
            const install = await tx.teamPluginInstall.create({
              data: {
                teamId: newTeam.id,
                deploymentId: deployment.id,
                installedBy: ownerId,
                status: 'active',
                enabled: true,
              },
            });

            // Grant access to the owner
            await tx.teamMemberPluginAccess.create({
              data: {
                memberId: ownerMember.id,
                pluginInstallId: install.id,
                visible: true,
                canUse: true,
                canConfigure: true,
              },
            });
          }
        }

        return newTeam;
      });

      // Audit log
      await lifecycleService.audit({
        action: 'team.create',
        resource: 'team',
        resourceId: team.id,
        userId: ownerId,
        details: { name: input.name, slug: input.slug },
      });

      return team;
    },

    /**
     * Get a team by ID
     */
    async getTeam(teamId: string): Promise<TeamWithMembers | null> {
      return prisma.team.findUnique({
        where: { id: teamId },
        include: {
          members: {
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
            orderBy: [
              { role: 'asc' },
              { joinedAt: 'asc' },
            ],
          },
          _count: {
            select: {
              members: true,
              pluginInstalls: true,
            },
          },
        },
      });
    },

    /**
     * Get a team by slug
     */
    async getTeamBySlug(slug: string): Promise<TeamWithMembers | null> {
      return prisma.team.findUnique({
        where: { slug },
        include: {
          members: {
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
          },
          _count: {
            select: {
              members: true,
              pluginInstalls: true,
            },
          },
        },
      });
    },

    /**
     * Get all teams for a user
     */
    async getUserTeams(userId: string): Promise<TeamWithMembers[]> {
      const memberships = await prisma.teamMember.findMany({
        where: { userId },
        include: {
          team: {
            include: {
              members: {
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
              },
              _count: {
                select: {
                  members: true,
                  pluginInstalls: true,
                },
              },
            },
          },
        },
        orderBy: { joinedAt: 'asc' },
      });

      return memberships.map((m) => m.team);
    },

    /**
     * Update a team
     */
    async updateTeam(teamId: string, input: UpdateTeamInput, userId: string): Promise<Team> {
      // Check user has permission
      const hasPermission = await this.hasTeamPermission(userId, teamId, 'team.manage');
      if (!hasPermission) {
        throw new Error('Permission denied: cannot update team');
      }

      const team = await prisma.team.update({
        where: { id: teamId },
        data: input,
      });

      await lifecycleService.audit({
        action: 'team.update',
        resource: 'team',
        resourceId: teamId,
        userId,
        details: { ...input } as Record<string, unknown>,
      });

      return team;
    },

    /**
     * Get deletion impact preview
     * Shows what will be deleted when team is removed
     */
    async getDeleteImpact(teamId: string): Promise<{
      memberCount: number;
      pluginCount: number;
      members: Array<{ id: string; displayName: string | null; email: string | null }>;
      plugins: Array<{ name: string; displayName: string }>;
    }> {
      const team = await prisma.team.findUnique({
        where: { id: teamId },
        include: {
          members: {
            include: {
              user: {
                select: { id: true, displayName: true, email: true },
              },
            },
          },
          pluginInstalls: {
            include: {
              deployment: {
                include: {
                  package: {
                    select: { name: true, displayName: true },
                  },
                },
              },
            },
          },
        },
      });

      if (!team) {
        throw new Error('Team not found');
      }

      return {
        memberCount: team.members.length,
        pluginCount: team.pluginInstalls.length,
        members: team.members.map(m => ({
          id: m.user.id,
          displayName: m.user.displayName,
          email: m.user.email,
        })),
        plugins: team.pluginInstalls.map(p => ({
          name: p.deployment.package.name,
          displayName: p.deployment.package.displayName,
        })),
      };
    },

    /**
     * Delete a team
     * Only the owner can delete a team
     * Properly cleans up plugin deployment activeInstalls counters
     */
    async deleteTeam(teamId: string, userId: string): Promise<void> {
      const team = await prisma.team.findUnique({
        where: { id: teamId },
        include: {
          pluginInstalls: {
            select: {
              id: true,
              deploymentId: true,
              deployment: {
                select: {
                  package: { select: { name: true } },
                },
              },
            },
          },
          _count: {
            select: { members: true },
          },
        },
      });

      if (!team) {
        throw new Error('Team not found');
      }

      if (team.ownerId !== userId) {
        throw new Error('Permission denied: only owner can delete team');
      }

      // Use transaction to ensure atomic cleanup
      await prisma.$transaction(async (tx) => {
        // Decrement activeInstalls for each plugin deployment
        for (const install of team.pluginInstalls) {
          await tx.pluginDeployment.update({
            where: { id: install.deploymentId },
            data: { activeInstalls: { decrement: 1 } },
          });
        }

        // Delete the team (cascades to members, plugin installs, etc.)
        await tx.team.delete({
          where: { id: teamId },
        });
      });

      await lifecycleService.audit({
        action: 'team.delete',
        resource: 'team',
        resourceId: teamId,
        userId,
        details: {
          name: team.name,
          memberCount: team._count.members,
          pluginCount: team.pluginInstalls.length,
          uninstalledPlugins: team.pluginInstalls.map(p => p.deployment.package.name),
        },
      });
    },

    /**
     * Get team member
     */
    async getTeamMember(teamId: string, userId: string): Promise<TeamMember | null> {
      return prisma.teamMember.findUnique({
        where: {
          teamId_userId: {
            teamId,
            userId,
          },
        },
      });
    },

    /**
     * Get user's role in a team
     */
    async getUserTeamRole(userId: string, teamId: string): Promise<TeamRole | null> {
      const member = await prisma.teamMember.findUnique({
        where: {
          teamId_userId: { teamId, userId },
        },
      });
      return member?.role as TeamRole | null;
    },

    /**
     * Check if user has a specific permission in a team
     */
    async hasTeamPermission(userId: string, teamId: string, permission: string): Promise<boolean> {
      const role = await this.getUserTeamRole(userId, teamId);
      if (!role) return false;
      
      const permissions = ROLE_PERMISSIONS[role] || [];
      return permissions.includes(permission);
    },

    /**
     * Invite a member to a team
     */
    async inviteMember(
      teamId: string,
      input: InviteMemberInput,
      inviterId: string
    ): Promise<TeamMember> {
      // Check inviter has permission
      const hasPermission = await this.hasTeamPermission(inviterId, teamId, 'members.invite');
      if (!hasPermission) {
        throw new Error('Permission denied: cannot invite members');
      }

      // Find user by email
      const user = await prisma.user.findUnique({
        where: { email: input.email },
      });

      if (!user) {
        throw new Error('User not found with this email');
      }

      // Check if user is already a member
      const existingMember = await prisma.teamMember.findUnique({
        where: {
          teamId_userId: { teamId, userId: user.id },
        },
      });

      if (existingMember) {
        throw new Error('User is already a team member');
      }

      // Cannot invite as owner
      if (input.role === 'owner') {
        throw new Error('Cannot invite as owner role');
      }

      const member = await prisma.teamMember.create({
        data: {
          teamId,
          userId: user.id,
          role: input.role,
          invitedBy: inviterId,
        },
      });

      await lifecycleService.audit({
        action: 'team.member.invite',
        resource: 'teamMember',
        resourceId: member.id,
        userId: inviterId,
        details: { teamId, invitedEmail: input.email, role: input.role },
      });

      return member;
    },

    /**
     * Update a member's role
     */
    async updateMemberRole(
      memberId: string,
      newRole: TeamRole,
      updaterId: string
    ): Promise<TeamMember> {
      const member = await prisma.teamMember.findUnique({
        where: { id: memberId },
        include: { team: true },
      });

      if (!member) {
        throw new Error('Team member not found');
      }

      // Check updater has permission
      const hasPermission = await this.hasTeamPermission(updaterId, member.teamId, 'members.manage');
      if (!hasPermission) {
        throw new Error('Permission denied: cannot manage members');
      }

      // Cannot change owner's role
      if (member.role === 'owner') {
        throw new Error('Cannot change owner role');
      }

      // Cannot promote to owner
      if (newRole === 'owner') {
        throw new Error('Cannot promote to owner role');
      }

      // Admin cannot demote another admin
      const updaterRole = await this.getUserTeamRole(updaterId, member.teamId);
      if (updaterRole === 'admin' && member.role === 'admin') {
        throw new Error('Admin cannot manage other admins');
      }

      const updated = await prisma.teamMember.update({
        where: { id: memberId },
        data: { role: newRole },
      });

      await lifecycleService.audit({
        action: 'team.member.update',
        resource: 'teamMember',
        resourceId: memberId,
        userId: updaterId,
        details: { fromRole: member.role, toRole: newRole },
      });

      return updated;
    },

    /**
     * Remove a member from a team
     */
    async removeMember(memberId: string, removerId: string): Promise<void> {
      const member = await prisma.teamMember.findUnique({
        where: { id: memberId },
        include: { team: true },
      });

      if (!member) {
        throw new Error('Team member not found');
      }

      // Owner cannot be removed
      if (member.role === 'owner') {
        throw new Error('Cannot remove team owner');
      }

      // Self-removal is allowed
      if (member.userId === removerId) {
        await prisma.teamMember.delete({ where: { id: memberId } });
        
        await lifecycleService.audit({
          action: 'team.member.leave',
          resource: 'teamMember',
          resourceId: memberId,
          userId: removerId,
          details: { teamId: member.teamId },
        });
        return;
      }

      // Check remover has permission
      const hasPermission = await this.hasTeamPermission(removerId, member.teamId, 'members.manage');
      if (!hasPermission) {
        throw new Error('Permission denied: cannot manage members');
      }

      // Admin cannot remove another admin
      const removerRole = await this.getUserTeamRole(removerId, member.teamId);
      if (removerRole === 'admin' && member.role === 'admin') {
        throw new Error('Admin cannot remove other admins');
      }

      await prisma.teamMember.delete({ where: { id: memberId } });

      await lifecycleService.audit({
        action: 'team.member.remove',
        resource: 'teamMember',
        resourceId: memberId,
        userId: removerId,
        details: { teamId: member.teamId, removedUserId: member.userId },
      });
    },

    /**
     * Transfer team ownership
     */
    async transferOwnership(teamId: string, newOwnerId: string, currentOwnerId: string): Promise<void> {
      const team = await prisma.team.findUnique({
        where: { id: teamId },
      });

      if (!team) {
        throw new Error('Team not found');
      }

      if (team.ownerId !== currentOwnerId) {
        throw new Error('Only the current owner can transfer ownership');
      }

      // Ensure new owner is a team member
      const newOwnerMember = await prisma.teamMember.findUnique({
        where: { teamId_userId: { teamId, userId: newOwnerId } },
      });

      if (!newOwnerMember) {
        throw new Error('New owner must be a team member');
      }

      await prisma.$transaction(async (tx) => {
        // Update team owner
        await tx.team.update({
          where: { id: teamId },
          data: { ownerId: newOwnerId },
        });

        // Update roles
        await tx.teamMember.update({
          where: { id: newOwnerMember.id },
          data: { role: 'owner' },
        });

        // Demote current owner to admin
        await tx.teamMember.updateMany({
          where: { teamId, userId: currentOwnerId },
          data: { role: 'admin' },
        });
      });

      await lifecycleService.audit({
        action: 'team.ownership.transfer',
        resource: 'team',
        resourceId: teamId,
        userId: currentOwnerId,
        details: { previousOwner: currentOwnerId, newOwner: newOwnerId },
      });
    },

    /**
     * List team members with pagination
     */
    async listMembers(
      teamId: string,
      options: { skip?: number; take?: number } = {}
    ): Promise<TeamMemberWithUser[]> {
      return prisma.teamMember.findMany({
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
          team: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
        orderBy: [
          { role: 'asc' },
          { joinedAt: 'asc' },
        ],
        skip: options.skip || 0,
        take: options.take || 50,
      });
    },

    /**
     * Get role permission definitions
     */
    getRolePermissions(): Record<TeamRole, string[]> {
      return ROLE_PERMISSIONS;
    },
  };
}

// Singleton for service reuse
let teamServiceInstance: ReturnType<typeof createTeamService> | null = null;

export function getTeamService(prisma: PrismaClient) {
  if (!teamServiceInstance) {
    teamServiceInstance = createTeamService(prisma);
  }
  return teamServiceInstance;
}
