/**
 * RBAC (Role-Based Access Control) Service
 * 
 * Provides role and permission management with delegation support.
 */

import { PrismaClient } from '@naap/database';
import { getDelegationService } from './delegation';
import { createLifecycleService } from './lifecycle';

export interface Permission {
  resource: string;
  action: 'create' | 'read' | 'update' | 'delete' | 'admin' | '*';
  scope?: string;
}

export interface RoleInput {
  name: string;
  displayName: string;
  description?: string;
  permissions: Permission[];
  canAssign?: string[];
  inherits?: string[];
  scope?: string;
  pluginName?: string;
}

export interface UserWithRoles {
  id: string;
  address: string;
  displayName?: string;
  roles: Array<{
    id: string;
    name: string;
    displayName: string;
    permissions: Permission[];
  }>;
}

export interface AuditOptions {
  ipAddress?: string;
  userAgent?: string;
}

export function createRBACService(prisma: PrismaClient) {
  const delegationService = getDelegationService(prisma);
  const lifecycleService = createLifecycleService(prisma);

  return {
    /**
     * Create or update a role
     */
    async upsertRole(input: RoleInput) {
      return prisma.role.upsert({
        where: { name: input.name },
        create: {
          name: input.name,
          displayName: input.displayName,
          description: input.description,
          permissions: input.permissions as object,
        },
        update: {
          displayName: input.displayName,
          description: input.description,
          permissions: input.permissions as object,
        },
      });
    },

    /**
     * Get all roles
     */
    async getRoles() {
      return prisma.role.findMany({
        orderBy: { name: 'asc' },
      });
    },

    /**
     * Get a role by name
     */
    async getRole(name: string) {
      return prisma.role.findUnique({
        where: { name },
      });
    },

    /**
     * Delete a role (non-system only)
     */
    async deleteRole(name: string) {
      const role = await prisma.role.findUnique({ where: { name } });
      if (!role) throw new Error('Role not found');
      if (role.isSystem) throw new Error('Cannot delete system role');
      
      await prisma.role.delete({ where: { name } });
      return true;
    },

    /**
     * Assign a role to a user
     */
    async assignRole(userId: string, roleName: string, grantedBy?: string) {
      const role = await prisma.role.findUnique({ where: { name: roleName } });
      if (!role) throw new Error('Role not found');

      return prisma.userRole.upsert({
        where: {
          userId_roleId: { userId, roleId: role.id },
        },
        create: {
          userId,
          roleId: role.id,
          grantedBy,
        },
        update: {
          grantedBy,
          grantedAt: new Date(),
        },
      });
    },

    /**
     * Remove a role from a user
     */
    async removeRole(userId: string, roleName: string) {
      const role = await prisma.role.findUnique({ where: { name: roleName } });
      if (!role) throw new Error('Role not found');

      await prisma.userRole.delete({
        where: {
          userId_roleId: { userId, roleId: role.id },
        },
      });
      return true;
    },

    /**
     * Get user with all roles
     */
    async getUserWithRoles(userId: string): Promise<UserWithRoles | null> {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          pluginPreferences: true,
        },
      });

      if (!user) return null;

      const userRoles = await prisma.userRole.findMany({
        where: { userId },
        include: { role: true },
      });

      return {
        id: user.id,
        address: user.address || '',
        displayName: user.displayName || undefined,
        roles: userRoles.map(ur => ({
          id: ur.role.id,
          name: ur.role.name,
          displayName: ur.role.displayName,
          permissions: ur.role.permissions as unknown as Permission[],
        })),
      };
    },

    /**
     * Get all permissions for a user
     */
    async getUserPermissions(userId: string): Promise<Permission[]> {
      const userRoles = await prisma.userRole.findMany({
        where: { userId },
        include: { role: true },
      });

      const permissions: Permission[] = [];
      for (const ur of userRoles) {
        const rolePerms = ur.role.permissions as unknown as Permission[];
        permissions.push(...rolePerms);
      }

      // Deduplicate
      return permissions.filter((p, i, arr) => 
        arr.findIndex(x => 
          x.resource === p.resource && 
          x.action === p.action && 
          x.scope === p.scope
        ) === i
      );
    },

    /**
     * Check if user has a specific permission
     */
    async hasPermission(
      userId: string,
      resource: string,
      action: string,
      scope?: string
    ): Promise<boolean> {
      const permissions = await this.getUserPermissions(userId);
      
      return permissions.some(p => {
        // Check resource match
        if (p.resource !== resource && p.resource !== '*') return false;
        
        // Check action match
        if (p.action !== action && p.action !== '*' && p.action !== 'admin') return false;
        
        // Check scope match (if specified)
        if (scope && p.scope && p.scope !== scope && p.scope !== '*') return false;
        
        return true;
      });
    },

    /**
     * Check if user has a specific role
     */
    async hasRole(userId: string, roleName: string): Promise<boolean> {
      const role = await prisma.role.findUnique({ where: { name: roleName } });
      if (!role) return false;

      const userRole = await prisma.userRole.findUnique({
        where: {
          userId_roleId: { userId, roleId: role.id },
        },
      });

      return !!userRole;
    },

    /**
     * Get user's roles
     */
    async getUserRoles(userId: string) {
      return prisma.userRole.findMany({
        where: { userId },
        include: { role: true },
      });
    },

    /**
     * Assign role to user with delegation check and audit
     */
    async assignRoleWithAudit(
      targetUserId: string,
      roleName: string,
      assignerId: string,
      options?: AuditOptions
    ) {
      // Delegation check
      const check = await delegationService.canAssign(assignerId, targetUserId, roleName);
      if (!check.allowed) {
        // Audit failed attempt
        await lifecycleService.audit({
          action: 'role.assign.denied',
          resource: 'role',
          resourceId: roleName,
          userId: assignerId,
          details: { targetUserId, reason: check.reason },
          status: 'failure',
          errorMsg: check.reason,
          ipAddress: options?.ipAddress,
          userAgent: options?.userAgent,
        });
        throw new Error(check.reason);
      }

      // Perform assignment
      const result = await this.assignRole(targetUserId, roleName, assignerId);

      // Audit success
      await lifecycleService.audit({
        action: 'role.assign',
        resource: 'role',
        resourceId: roleName,
        userId: assignerId,
        details: { targetUserId },
        status: 'success',
        ipAddress: options?.ipAddress,
        userAgent: options?.userAgent,
      });

      return result;
    },

    /**
     * Revoke role from user with delegation check and audit
     */
    async revokeRoleWithAudit(
      targetUserId: string,
      roleName: string,
      revokerId: string,
      options?: AuditOptions
    ) {
      // Same delegation check applies for revocation
      const check = await delegationService.canAssign(revokerId, targetUserId, roleName);
      if (!check.allowed) {
        await lifecycleService.audit({
          action: 'role.revoke.denied',
          resource: 'role',
          resourceId: roleName,
          userId: revokerId,
          details: { targetUserId, reason: check.reason },
          status: 'failure',
          errorMsg: check.reason,
          ipAddress: options?.ipAddress,
          userAgent: options?.userAgent,
        });
        throw new Error(check.reason);
      }

      await this.removeRole(targetUserId, roleName);

      await lifecycleService.audit({
        action: 'role.revoke',
        resource: 'role',
        resourceId: roleName,
        userId: revokerId,
        details: { targetUserId },
        status: 'success',
        ipAddress: options?.ipAddress,
        userAgent: options?.userAgent,
      });
    },

    /**
     * Resolve permissions with inheritance
     */
    async getEffectivePermissions(userId: string): Promise<Permission[]> {
      const userRoles = await this.getUserRoles(userId);
      const visited = new Set<string>();
      const permissions: Permission[] = [];

      const resolve = async (roleName: string) => {
        if (visited.has(roleName)) return;
        visited.add(roleName);

        const role = await prisma.role.findUnique({ where: { name: roleName } });
        if (!role) return;

        permissions.push(...(role.permissions as unknown as Permission[]));

        // Resolve inherited roles
        for (const parent of role.inherits || []) {
          await resolve(parent);
        }
      };

      for (const ur of userRoles) {
        await resolve(ur.role.name);
      }

      // Deduplicate
      return this.deduplicatePermissions(permissions);
    },

    /**
     * Deduplicate permissions array
     */
    deduplicatePermissions(permissions: Permission[]): Permission[] {
      return permissions.filter((p, i, arr) =>
        arr.findIndex(
          (x) =>
            x.resource === p.resource &&
            x.action === p.action &&
            x.scope === p.scope
        ) === i
      );
    },

    /**
     * Get all users with their roles
     */
    async getAllUsersWithRoles(): Promise<Array<{
      id: string;
      email?: string;
      address?: string;
      displayName?: string;
      roles: string[];
    }>> {
      const users = await prisma.user.findMany({
        select: { id: true, email: true, address: true, displayName: true },
      });

      const userRoles = await prisma.userRole.findMany({
        include: { role: true },
      });

      const userRolesMap = new Map<string, string[]>();
      for (const ur of userRoles) {
        if (!userRolesMap.has(ur.userId)) {
          userRolesMap.set(ur.userId, []);
        }
        userRolesMap.get(ur.userId)!.push(ur.role.name);
      }

      return users.map((user) => ({
        id: user.id,
        email: user.email || undefined,
        address: user.address || undefined,
        displayName: user.displayName || undefined,
        roles: userRolesMap.get(user.id) || [],
      }));
    },

    /**
     * Create default system roles with delegation powers
     */
    async initializeDefaultRoles() {
      const systemRoles = [
        {
          name: 'system:root',
          displayName: 'System Root',
          description: 'Unrestricted access (database-only assignment)',
          permissions: [{ resource: '*', action: '*' }],
          canAssign: ['*'],  // Can assign anything
          inherits: [],
          scope: 'system',
          isSystem: true,
        },
        {
          name: 'system:admin',
          displayName: 'Platform Administrator',
          description: 'Manages users, plugins, and marketplace',
          permissions: [
            { resource: 'user', action: '*' },
            { resource: 'role', action: '*' },
            { resource: 'plugin', action: '*' },
            { resource: 'marketplace', action: '*' },
            { resource: 'audit', action: 'read' },
          ],
          canAssign: ['system:admin', 'system:operator', 'system:viewer'],
          inherits: ['system:operator'],
          scope: 'system',
          isSystem: true,
        },
        {
          name: 'system:operator',
          displayName: 'Platform Operator',
          description: 'Infrastructure operations, no role management',
          permissions: [
            { resource: 'gateway', action: '*' },
            { resource: 'orchestrator', action: '*' },
            { resource: 'plugin', action: 'read' },
          ],
          canAssign: [],  // Cannot assign roles
          inherits: ['system:viewer'],
          scope: 'system',
          isSystem: true,
        },
        {
          name: 'system:viewer',
          displayName: 'Viewer',
          description: 'Read-only access',
          permissions: [{ resource: '*', action: 'read' }],
          canAssign: [],
          inherits: [],
          scope: 'system',
          isSystem: true,
        },
      ];

      for (const role of systemRoles) {
        await prisma.role.upsert({
          where: { name: role.name },
          create: {
            name: role.name,
            displayName: role.displayName,
            description: role.description,
            permissions: role.permissions as object,
            canAssign: role.canAssign,
            inherits: role.inherits,
            scope: role.scope,
            isSystem: role.isSystem,
          },
          update: {
            displayName: role.displayName,
            description: role.description,
            permissions: role.permissions as object,
            canAssign: role.canAssign,
            inherits: role.inherits,
          },
        });
      }
    },
  };
}

// Singleton
let rbacService: ReturnType<typeof createRBACService> | null = null;

export function getRBACService(prisma: PrismaClient) {
  if (!rbacService) {
    rbacService = createRBACService(prisma);
  }
  return rbacService;
}
