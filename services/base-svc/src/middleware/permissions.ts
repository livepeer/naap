/**
 * Permission Middleware for Team-based RBAC
 *
 * Provides middleware factories for checking team membership and permissions.
 */

import { Request, Response, NextFunction } from 'express';
import { db } from '../db/client';
import { errors } from '../utils/response';

/**
 * Extended request with team and user context
 */
export interface TeamContextRequest extends Request {
  user?: {
    id: string;
    email?: string;
  };
  team?: {
    id: string;
    name: string;
    userRole: string;
  };
}

/**
 * Team roles with their permission levels (higher = more permissions)
 */
export const TeamRoles = {
  viewer: 1,
  member: 2,
  admin: 3,
  owner: 4,
} as const;

export type TeamRole = keyof typeof TeamRoles;

/**
 * Permission definitions
 */
export const Permissions = {
  // Team management
  'team:read': ['viewer', 'member', 'admin', 'owner'],
  'team:update': ['admin', 'owner'],
  'team:delete': ['owner'],

  // Member management
  'members:read': ['viewer', 'member', 'admin', 'owner'],
  'members:invite': ['admin', 'owner'],
  'members:remove': ['admin', 'owner'],
  'members:update_role': ['owner'],

  // Plugin management
  'plugins:read': ['viewer', 'member', 'admin', 'owner'],
  'plugins:install': ['admin', 'owner'],
  'plugins:uninstall': ['admin', 'owner'],
  'plugins:configure': ['admin', 'owner'],
  'plugins:configure_personal': ['member', 'admin', 'owner'],

  // Settings management
  'settings:read': ['member', 'admin', 'owner'],
  'settings:update': ['admin', 'owner'],

  // Billing
  'billing:read': ['admin', 'owner'],
  'billing:update': ['owner'],
} as const;

export type Permission = keyof typeof Permissions;

/**
 * Check if a role has a specific permission
 */
export function roleHasPermission(role: TeamRole, permission: Permission): boolean {
  const allowedRoles = Permissions[permission] as readonly string[];
  return allowedRoles.includes(role);
}

/**
 * Middleware factory to require team membership
 * Extracts teamId from request params and validates membership
 */
export function requireTeamMembership(teamIdParam: string = 'teamId') {
  return async (req: TeamContextRequest, res: Response, next: NextFunction) => {
    try {
      const teamId = req.params[teamIdParam];
      const userId = req.user?.id;

      if (!userId) {
        return errors.unauthorized(res, 'Authentication required');
      }

      if (!teamId) {
        return errors.badRequest(res, `Missing ${teamIdParam} parameter`);
      }

      // Find team membership
      const membership = await db.teamMember.findUnique({
        where: {
          teamId_userId: {
            teamId,
            userId,
          },
        },
        include: {
          team: {
            select: {
              id: true,
              name: true,
            },
          },
        },
      });

      if (!membership) {
        return errors.forbidden(res, 'You are not a member of this team');
      }

      // Attach team context to request
      req.team = {
        id: membership.team.id,
        name: membership.team.name,
        userRole: membership.role,
      };

      next();
    } catch (error) {
      console.error('Team membership check error:', error);
      errors.internal(res, 'Failed to verify team membership');
    }
  };
}

/**
 * Middleware factory to require a specific permission
 * Must be used after requireTeamMembership
 */
export function requirePermission(permission: Permission) {
  return (req: TeamContextRequest, res: Response, next: NextFunction) => {
    const role = req.team?.userRole as TeamRole | undefined;

    if (!role) {
      return errors.forbidden(res, 'Team context not available');
    }

    if (!roleHasPermission(role, permission)) {
      return errors.forbidden(
        res,
        `Permission denied: '${permission}' requires one of: ${Permissions[permission].join(', ')}`
      );
    }

    next();
  };
}

/**
 * Middleware factory to require minimum role level
 */
export function requireMinRole(minRole: TeamRole) {
  return (req: TeamContextRequest, res: Response, next: NextFunction) => {
    const role = req.team?.userRole as TeamRole | undefined;

    if (!role) {
      return errors.forbidden(res, 'Team context not available');
    }

    if (TeamRoles[role] < TeamRoles[minRole]) {
      return errors.forbidden(res, `Requires ${minRole} role or higher`);
    }

    next();
  };
}

/**
 * Middleware factory to check plugin-specific permissions
 */
export function requirePluginPermission(
  pluginPermission: 'read' | 'configure' | 'admin',
  installIdParam: string = 'installId'
) {
  return async (req: TeamContextRequest, res: Response, next: NextFunction) => {
    try {
      const installId = req.params[installIdParam];
      const userId = req.user?.id;
      const teamId = req.team?.id;

      if (!userId || !teamId) {
        return errors.forbidden(res, 'Team context required');
      }

      if (!installId) {
        return errors.badRequest(res, `Missing ${installIdParam} parameter`);
      }

      // Get user's plugin access
      const access = await db.teamMemberPluginAccess.findUnique({
        where: {
          memberId_pluginInstallId: {
            memberId: userId, // This should be team member ID
            pluginInstallId: installId,
          },
        },
      });

      // Check team-level role as fallback
      const teamRole = req.team?.userRole as TeamRole;
      const isTeamAdmin = teamRole === 'admin' || teamRole === 'owner';

      // Determine effective permission
      let hasPermission = false;

      switch (pluginPermission) {
        case 'read':
          hasPermission = !!access?.canUse || isTeamAdmin;
          break;
        case 'configure':
          hasPermission = !!access?.canConfigure || isTeamAdmin;
          break;
        case 'admin':
          hasPermission = isTeamAdmin;
          break;
      }

      if (!hasPermission) {
        return errors.forbidden(res, `Plugin ${pluginPermission} permission required`);
      }

      next();
    } catch (error) {
      console.error('Plugin permission check error:', error);
      errors.internal(res, 'Failed to verify plugin permissions');
    }
  };
}

/**
 * Combine multiple middleware functions
 */
export function combineMiddleware(
  ...middlewares: Array<(req: Request, res: Response, next: NextFunction) => void>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    const runMiddleware = (index: number) => {
      if (index >= middlewares.length) {
        return next();
      }

      middlewares[index](req, res, (err?: unknown) => {
        if (err) {
          return next(err);
        }
        runMiddleware(index + 1);
      });
    };

    runMiddleware(0);
  };
}

/**
 * Helper to check permissions in route handlers
 */
export function checkPermission(
  userRole: string | undefined,
  permission: Permission
): { allowed: boolean; reason?: string } {
  if (!userRole) {
    return { allowed: false, reason: 'No role assigned' };
  }

  const role = userRole as TeamRole;
  if (!TeamRoles[role]) {
    return { allowed: false, reason: `Invalid role: ${role}` };
  }

  if (!roleHasPermission(role, permission)) {
    return {
      allowed: false,
      reason: `'${permission}' requires: ${Permissions[permission].join(', ')}`,
    };
  }

  return { allowed: true };
}
