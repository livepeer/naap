/**
 * Team Routes
 * 
 * API endpoints for team/organization management.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@naap/database';
import { 
  createTeamContextMiddleware, 
  requireTeamContext, 
  requireTeamOwner 
} from '../middleware/teamContext';
import { createTeamService, TeamRole } from '../services/team';
import { createTeamPluginService } from '../services/teamPlugin';
import { createAuthService } from '../services/auth';

// Helper to get user ID from request
function getUserId(req: Request): string | undefined {
  return (req as any).user?.id;
}

// Helper middleware to require authentication
function createAuthMiddleware(db: PrismaClient) {
  const authService = createAuthService(db);
  
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authHeader = req.headers.authorization;
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ success: false, error: 'Authorization required' });
      }
      
      const token = authHeader.substring(7);
      const user = await authService.validateSession(token);
      
      if (!user) {
        return res.status(401).json({ success: false, error: 'Invalid or expired session' });
      }
      
      // Set user on request
      (req as any).user = {
        id: user.id,
        email: user.email || undefined,
        displayName: user.displayName || undefined,
        roles: user.roles,
      };
      next();
    } catch (error) {
      console.error('Auth middleware error:', error);
      res.status(500).json({ success: false, error: 'Authentication failed' });
    }
  };
}

export function createTeamRoutes(db: PrismaClient) {
  const router = Router();
  const teamService = createTeamService(db);
  const teamPluginService = createTeamPluginService(db);
  const teamContextMiddleware = createTeamContextMiddleware(db);
  const authMiddleware = createAuthMiddleware(db);

  // ============================================
  // Team CRUD
  // ============================================

  // Create a new team
  router.post('/teams', authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { name, slug, description, avatarUrl } = req.body;

      if (!name || !slug) {
        return res.status(400).json({ success: false, error: 'Name and slug are required' });
      }

      // Validate slug format
      if (!/^[a-z0-9-]+$/.test(slug)) {
        return res.status(400).json({ 
          success: false, 
          error: 'Slug must contain only lowercase letters, numbers, and hyphens' 
        });
      }

      const team = await teamService.createTeam(userId, {
        name,
        slug,
        description,
        avatarUrl,
      });

      res.status(201).json({ success: true, team });
    } catch (error: any) {
      console.error('Error creating team:', error);
      res.status(400).json({ success: false, error: error.message || 'Failed to create team' });
    }
  });

  // List user's teams
  router.get('/teams', authMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const teams = await teamService.getUserTeams(userId);
      res.json({ success: true, teams });
    } catch (error: any) {
      console.error('Error listing teams:', error);
      res.status(500).json({ success: false, error: 'Failed to list teams' });
    }
  });

  // Get team by ID
  router.get('/teams/:teamId', authMiddleware, teamContextMiddleware, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      const team = await teamService.getTeam(req.params.teamId);
      if (!team) {
        return res.status(404).json({ success: false, error: 'Team not found' });
      }

      // Check if user is a member
      const member = await teamService.getTeamMember(req.params.teamId, userId || '');
      if (!member) {
        return res.status(403).json({ success: false, error: 'Not a member of this team' });
      }

      res.json({ success: true, team, membership: { role: member.role } });
    } catch (error: any) {
      console.error('Error getting team:', error);
      res.status(500).json({ success: false, error: 'Failed to get team' });
    }
  });

  // Update team
  router.put('/teams/:teamId', authMiddleware, teamContextMiddleware, requireTeamContext, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { name, description, avatarUrl } = req.body;

      const team = await teamService.updateTeam(
        req.params.teamId,
        { name, description, avatarUrl },
        userId
      );

      res.json({ success: true, team });
    } catch (error: any) {
      console.error('Error updating team:', error);
      res.status(400).json({ success: false, error: error.message || 'Failed to update team' });
    }
  });

  // Get delete impact preview (what will be deleted)
  router.get('/teams/:teamId/delete-impact', authMiddleware, teamContextMiddleware, requireTeamOwner, async (req: Request, res: Response) => {
    try {
      const impact = await teamService.getDeleteImpact(req.params.teamId);
      res.json({ success: true, impact });
    } catch (error: any) {
      console.error('Error getting delete impact:', error);
      res.status(400).json({ success: false, error: error.message || 'Failed to get delete impact' });
    }
  });

  // Delete team
  router.delete('/teams/:teamId', authMiddleware, teamContextMiddleware, requireTeamOwner, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      await teamService.deleteTeam(req.params.teamId, userId);
      res.json({ success: true, message: 'Team deleted' });
    } catch (error: any) {
      console.error('Error deleting team:', error);
      res.status(400).json({ success: false, error: error.message || 'Failed to delete team' });
    }
  });

  // ============================================
  // Team Members
  // ============================================

  // List team members
  router.get('/teams/:teamId/members', authMiddleware, teamContextMiddleware, requireTeamContext, async (req: Request, res: Response) => {
    try {
      const skip = parseInt(req.query.skip as string) || 0;
      const take = parseInt(req.query.take as string) || 50;

      const members = await teamService.listMembers(req.params.teamId, { skip, take });
      res.json({ success: true, members });
    } catch (error: any) {
      console.error('Error listing members:', error);
      res.status(500).json({ success: false, error: 'Failed to list members' });
    }
  });

  // Invite member
  router.post('/teams/:teamId/members', authMiddleware, teamContextMiddleware, requireTeamContext, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { email, role } = req.body;

      if (!email) {
        return res.status(400).json({ success: false, error: 'Email is required' });
      }

      // Validate role
      const validRoles: TeamRole[] = ['admin', 'member', 'viewer'];
      if (!validRoles.includes(role as TeamRole)) {
        return res.status(400).json({ success: false, error: 'Invalid role' });
      }

      const member = await teamService.inviteMember(
        req.params.teamId,
        { email, role: role as TeamRole },
        userId
      );

      res.status(201).json({ success: true, member });
    } catch (error: any) {
      console.error('Error inviting member:', error);
      res.status(400).json({ success: false, error: error.message || 'Failed to invite member' });
    }
  });

  // Update member role
  router.put('/teams/:teamId/members/:memberId', authMiddleware, teamContextMiddleware, requireTeamContext, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { role } = req.body;

      // Validate role
      const validRoles: TeamRole[] = ['admin', 'member', 'viewer'];
      if (!validRoles.includes(role as TeamRole)) {
        return res.status(400).json({ success: false, error: 'Invalid role' });
      }

      const member = await teamService.updateMemberRole(
        req.params.memberId,
        role as TeamRole,
        userId
      );

      res.json({ success: true, member });
    } catch (error: any) {
      console.error('Error updating member:', error);
      res.status(400).json({ success: false, error: error.message || 'Failed to update member' });
    }
  });

  // Remove member
  router.delete('/teams/:teamId/members/:memberId', authMiddleware, teamContextMiddleware, requireTeamContext, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      await teamService.removeMember(req.params.memberId, userId);
      res.json({ success: true, message: 'Member removed' });
    } catch (error: any) {
      console.error('Error removing member:', error);
      res.status(400).json({ success: false, error: error.message || 'Failed to remove member' });
    }
  });

  // Transfer ownership
  router.post('/teams/:teamId/transfer-ownership', authMiddleware, teamContextMiddleware, requireTeamOwner, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { newOwnerId } = req.body;

      if (!newOwnerId) {
        return res.status(400).json({ success: false, error: 'New owner ID is required' });
      }

      await teamService.transferOwnership(req.params.teamId, newOwnerId, userId);
      res.json({ success: true, message: 'Ownership transferred' });
    } catch (error: any) {
      console.error('Error transferring ownership:', error);
      res.status(400).json({ success: false, error: error.message || 'Failed to transfer ownership' });
    }
  });

  // ============================================
  // Team Plugins
  // ============================================

  // List team plugins
  router.get('/teams/:teamId/plugins', authMiddleware, teamContextMiddleware, requireTeamContext, async (req: Request, res: Response) => {
    try {
      const plugins = await teamPluginService.getTeamPlugins(req.params.teamId);
      res.json({ success: true, plugins });
    } catch (error: any) {
      console.error('Error listing team plugins:', error);
      res.status(500).json({ success: false, error: 'Failed to list plugins' });
    }
  });

  // Install plugin for team
  router.post('/teams/:teamId/plugins', authMiddleware, teamContextMiddleware, requireTeamContext, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { packageName } = req.body;

      if (!packageName) {
        return res.status(400).json({ success: false, error: 'Package name is required' });
      }

      const install = await teamPluginService.installPlugin(
        req.params.teamId,
        packageName,
        userId
      );

      res.status(201).json({ success: true, install });
    } catch (error: any) {
      console.error('Error installing team plugin:', error);
      res.status(400).json({ success: false, error: error.message || 'Failed to install plugin' });
    }
  });

  // Uninstall plugin from team
  router.delete('/teams/:teamId/plugins/:installId', authMiddleware, teamContextMiddleware, requireTeamContext, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      await teamPluginService.uninstallPlugin(req.params.installId, userId);
      res.json({ success: true, message: 'Plugin uninstalled' });
    } catch (error: any) {
      console.error('Error uninstalling team plugin:', error);
      res.status(400).json({ success: false, error: error.message || 'Failed to uninstall plugin' });
    }
  });

  // Update shared config
  router.put('/teams/:teamId/plugins/:installId/config', authMiddleware, teamContextMiddleware, requireTeamOwner, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { config } = req.body;

      const install = await teamPluginService.updateSharedConfig(
        req.params.installId,
        config || {},
        userId
      );

      res.json({ success: true, install });
    } catch (error: any) {
      console.error('Error updating shared config:', error);
      res.status(400).json({ success: false, error: error.message || 'Failed to update config' });
    }
  });

  // Toggle plugin enabled
  router.patch('/teams/:teamId/plugins/:installId/toggle', authMiddleware, teamContextMiddleware, requireTeamContext, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { enabled } = req.body;

      if (typeof enabled !== 'boolean') {
        return res.status(400).json({ success: false, error: 'Enabled must be a boolean' });
      }

      const install = await teamPluginService.togglePluginEnabled(
        req.params.installId,
        enabled,
        userId
      );

      res.json({ success: true, install });
    } catch (error: any) {
      console.error('Error toggling plugin:', error);
      res.status(400).json({ success: false, error: error.message || 'Failed to toggle plugin' });
    }
  });

  // ============================================
  // Member Plugin Access
  // ============================================

  // Get member's accessible plugins
  router.get('/teams/:teamId/members/:memberId/access', authMiddleware, teamContextMiddleware, requireTeamContext, async (req: Request, res: Response) => {
    try {
      const access = await teamPluginService.getMemberAccess(req.params.memberId);
      res.json({ success: true, access });
    } catch (error: any) {
      console.error('Error getting member access:', error);
      res.status(500).json({ success: false, error: 'Failed to get access' });
    }
  });

  // Set member's plugin access
  router.put('/teams/:teamId/members/:memberId/access/:pluginInstallId', authMiddleware, teamContextMiddleware, requireTeamContext, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { visible, canUse, canConfigure, pluginRole } = req.body;

      const access = await teamPluginService.setMemberAccess(
        req.params.memberId,
        req.params.pluginInstallId,
        { visible, canUse, canConfigure, pluginRole },
        userId
      );

      res.json({ success: true, access });
    } catch (error: any) {
      console.error('Error setting member access:', error);
      res.status(400).json({ success: false, error: error.message || 'Failed to set access' });
    }
  });

  // Get user's accessible plugins in team context
  // Returns plugins in TeamAccessiblePlugin format for frontend compatibility
  router.get('/teams/:teamId/my-plugins', authMiddleware, teamContextMiddleware, requireTeamContext, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const plugins = await teamPluginService.getUserAccessiblePlugins(
        userId,
        req.params.teamId
      );

      // Transform MemberPluginAccessWithDetails to TeamAccessiblePlugin format
      // This matches the format expected by the frontend PluginContext
      const transformed = plugins.map(p => ({
        installId: p.id,
        visible: p.visible,
        canUse: p.canUse,
        canConfigure: p.canConfigure,
        pluginRole: p.pluginRole,
        mergedConfig: {
          ...(typeof p.pluginInstall.sharedConfig === 'object' ? p.pluginInstall.sharedConfig : {}),
          ...(p.personalConfig?.personalConfig && typeof p.personalConfig.personalConfig === 'object' 
            ? p.personalConfig.personalConfig 
            : {}),
        },
        deployment: {
          id: p.pluginInstall.deployment.id,
          frontendUrl: p.pluginInstall.deployment.frontendUrl,
          backendUrl: p.pluginInstall.deployment.backendUrl,
          package: {
            ...p.pluginInstall.deployment.package,
            version: '1.0.0', // Default version for team plugins
            routes: [`/${p.pluginInstall.deployment.package.name}`],
          },
        },
      }));

      res.json({ success: true, plugins: transformed });
    } catch (error: any) {
      console.error('Error getting user plugins:', error);
      res.status(500).json({ success: false, error: 'Failed to get plugins' });
    }
  });

  // Update current user's own plugin visibility in team context
  router.put('/teams/:teamId/members/me/plugins/:installId', authMiddleware, teamContextMiddleware, requireTeamContext, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { teamId, installId } = req.params;
      const { visible } = req.body;

      // Get member record
      const member = await teamService.getTeamMember(teamId, userId);
      if (!member) {
        return res.status(403).json({ success: false, error: 'Not a team member' });
      }

      // Update the member's plugin access visibility
      const updated = await teamPluginService.updateMemberAccess(
        member.id,
        installId,
        { visible: visible !== false }
      );

      res.json({ success: true, access: updated });
    } catch (error: any) {
      console.error('Error updating plugin visibility:', error);
      res.status(400).json({ success: false, error: error.message || 'Failed to update visibility' });
    }
  });

  // Update personal config
  router.put('/teams/:teamId/plugins/:pluginInstallId/my-config', authMiddleware, teamContextMiddleware, requireTeamContext, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      // Get member ID
      const member = await teamService.getTeamMember(req.params.teamId, userId);
      if (!member) {
        return res.status(403).json({ success: false, error: 'Not a team member' });
      }

      const { config } = req.body;

      const configRecord = await teamPluginService.updatePersonalConfig(
        member.id,
        req.params.pluginInstallId,
        config || {},
        userId
      );

      res.json({ success: true, config: configRecord });
    } catch (error: any) {
      console.error('Error updating personal config:', error);
      res.status(400).json({ success: false, error: error.message || 'Failed to update config' });
    }
  });

  // Get merged config (shared + personal)
  router.get('/teams/:teamId/plugins/:pluginInstallId/merged-config', authMiddleware, teamContextMiddleware, requireTeamContext, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      // Get member ID
      const member = await teamService.getTeamMember(req.params.teamId, userId);
      if (!member) {
        return res.status(403).json({ success: false, error: 'Not a team member' });
      }

      const config = await teamPluginService.getMergedConfig(
        member.id,
        req.params.pluginInstallId
      );

      res.json({ success: true, config });
    } catch (error: any) {
      console.error('Error getting merged config:', error);
      res.status(500).json({ success: false, error: 'Failed to get config' });
    }
  });

  // ============================================
  // Version Pinning (Phase 7: Production Feature)
  // ============================================

  // Get available versions for a plugin installation
  router.get('/teams/:teamId/plugins/:installId/versions', authMiddleware, teamContextMiddleware, requireTeamContext, async (req: Request, res: Response) => {
    try {
      const versions = await teamPluginService.getAvailableVersions(req.params.installId);
      res.json({ success: true, versions });
    } catch (error: any) {
      console.error('Error getting plugin versions:', error);
      res.status(500).json({ success: false, error: 'Failed to get versions' });
    }
  });

  // Pin plugin to a specific version
  router.post('/teams/:teamId/plugins/:installId/pin-version', authMiddleware, teamContextMiddleware, requireTeamContext, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      const { versionId } = req.body;
      if (!versionId) {
        return res.status(400).json({ success: false, error: 'versionId is required' });
      }

      await teamPluginService.pinVersion(
        req.params.installId,
        versionId,
        userId,
        req.params.teamId
      );

      res.json({ success: true, message: 'Version pinned successfully' });
    } catch (error: any) {
      console.error('Error pinning version:', error);
      res.status(400).json({ success: false, error: error.message || 'Failed to pin version' });
    }
  });

  // Unpin plugin version (allow auto-upgrade)
  router.delete('/teams/:teamId/plugins/:installId/pin-version', authMiddleware, teamContextMiddleware, requireTeamContext, async (req: Request, res: Response) => {
    try {
      const userId = getUserId(req);
      if (!userId) {
        return res.status(401).json({ success: false, error: 'Unauthorized' });
      }

      await teamPluginService.unpinVersion(
        req.params.installId,
        userId,
        req.params.teamId
      );

      res.json({ success: true, message: 'Version unpinned successfully' });
    } catch (error: any) {
      console.error('Error unpinning version:', error);
      res.status(400).json({ success: false, error: error.message || 'Failed to unpin version' });
    }
  });

  // Get role permissions
  router.get('/teams/role-permissions', authMiddleware, async (_req: Request, res: Response) => {
    try {
      const permissions = teamService.getRolePermissions();
      res.json({ success: true, permissions });
    } catch (error: any) {
      console.error('Error getting role permissions:', error);
      res.status(500).json({ success: false, error: 'Failed to get permissions' });
    }
  });

  return router;
}
