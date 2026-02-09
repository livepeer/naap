/**
 * Delegation Service
 * 
 * Handles role assignment delegation rules and pattern matching.
 * Single Responsibility: Determines who can assign which roles to whom.
 */

import { PrismaClient, Role } from '@naap/database';

export interface AssignmentCheck {
  allowed: boolean;
  reason?: string;
}

export function createDelegationService(prisma: PrismaClient) {
  return {
    /**
     * Check if assigner can assign a role to target user
     */
    async canAssign(
      assignerId: string,
      targetUserId: string,
      roleName: string
    ): Promise<AssignmentCheck> {
      // Rule 1: Cannot modify own roles
      if (assignerId === targetUserId) {
        return { allowed: false, reason: 'Cannot modify your own roles' };
      }

      // Rule 2: Get the role to be assigned
      const targetRole = await prisma.role.findUnique({
        where: { name: roleName },
      });
      if (!targetRole) {
        return { allowed: false, reason: 'Role does not exist' };
      }

      // Rule 3: system:root can only be assigned via database
      if (roleName === 'system:root') {
        return { allowed: false, reason: 'system:root cannot be assigned via API' };
      }

      // Rule 4: Get assigner's roles with their canAssign patterns
      const assignerRoles = await prisma.userRole.findMany({
        where: { userId: assignerId },
        include: { role: true },
      });

      // Collect all patterns assigner can assign
      const patterns: string[] = [];
      for (const ur of assignerRoles) {
        patterns.push(...(ur.role.canAssign || []));
      }

      // Rule 5: Check if target role matches any pattern
      const isAllowed = patterns.some((pattern) =>
        this.matchesPattern(roleName, pattern)
      );

      return isAllowed
        ? { allowed: true }
        : { allowed: false, reason: `Cannot assign role: ${roleName}` };
    },

    /**
     * Pattern matching for role assignment
     * - "*" matches everything
     * - "system:*" matches all system roles
     * - "plugin:*" matches all plugin roles
     * - "<plugin>:*" matches all roles for that plugin
     */
    matchesPattern(roleName: string, pattern: string): boolean {
      if (pattern === '*') return true;
      if (pattern.endsWith(':*')) {
        return roleName.startsWith(pattern.slice(0, -1));
      }
      return pattern === roleName;
    },

    /**
     * Get roles a user can assign (for UI dropdown)
     */
    async getAssignableRoles(userId: string): Promise<string[]> {
      const userRoles = await prisma.userRole.findMany({
        where: { userId },
        include: { role: true },
      });

      const patterns: string[] = [];
      for (const ur of userRoles) {
        patterns.push(...(ur.role.canAssign || []));
      }

      if (patterns.length === 0) return [];

      // Fetch all roles and filter by patterns
      const allRoles = await prisma.role.findMany({
        where: { name: { not: 'system:root' } }, // Never show root
      });

      return allRoles
        .filter((role) => patterns.some((p) => this.matchesPattern(role.name, p)))
        .map((r) => r.name);
    },

    /**
     * Get roles visible to a plugin admin (scoped)
     */
    async getPluginRoles(pluginName: string): Promise<Role[]> {
      return prisma.role.findMany({
        where: { pluginName },
        orderBy: { name: 'asc' },
      });
    },

    /**
     * Get users who have roles for a specific plugin
     */
    async getPluginUsers(pluginName: string): Promise<Array<{
      id: string;
      displayName: string;
      roles: string[];
    }>> {
      // Get all roles for this plugin
      const pluginRoles = await prisma.role.findMany({
        where: { pluginName },
        select: { id: true, name: true },
      });

      const roleIds = pluginRoles.map((r) => r.id);
      const roleNameMap = new Map(pluginRoles.map((r) => [r.id, r.name]));

      // Get all user roles for these roles
      const userRoles = await prisma.userRole.findMany({
        where: { roleId: { in: roleIds } },
        select: { userId: true, roleId: true },
      });

      // Group by user
      const userRolesMap = new Map<string, string[]>();
      for (const ur of userRoles) {
        const roleName = roleNameMap.get(ur.roleId);
        if (!roleName) continue;
        
        if (!userRolesMap.has(ur.userId)) {
          userRolesMap.set(ur.userId, []);
        }
        userRolesMap.get(ur.userId)!.push(roleName);
      }

      // Get user details
      const userIds = Array.from(userRolesMap.keys());
      const users = await prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, displayName: true, address: true },
      });

      return users.map((user) => ({
        id: user.id,
        displayName: user.displayName || user.address || 'Unknown',
        roles: userRolesMap.get(user.id) || [],
      }));
    },

    /**
     * Check if a user is a plugin admin
     */
    async isPluginAdmin(userId: string, pluginName: string): Promise<boolean> {
      const adminRoleName = `${pluginName}:admin`;
      const userRole = await prisma.userRole.findFirst({
        where: {
          userId,
          role: { name: adminRoleName },
        },
      });
      return !!userRole;
    },

    /**
     * Check if user has system admin privileges
     */
    async isSystemAdmin(userId: string): Promise<boolean> {
      const userRoles = await prisma.userRole.findMany({
        where: { userId },
        include: { role: true },
      });

      return userRoles.some(
        (ur) => ur.role.name === 'system:root' || ur.role.name === 'system:admin'
      );
    },
  };
}

// Singleton instance
let delegationService: ReturnType<typeof createDelegationService> | null = null;

export function getDelegationService(prisma: PrismaClient) {
  if (!delegationService) {
    delegationService = createDelegationService(prisma);
  }
  return delegationService;
}
