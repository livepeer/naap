/**
 * Admin Tenant Management Routes
 * 
 * Phase 1.5: Admin & Governance for multi-tenant lifecycle management.
 * 
 * Provides admin endpoints to:
 * - List and manage tenants
 * - View/edit tenant plugin installations
 * - Approve/reject plugin installs
 * - View/edit tenant configs with version history
 * - Audit log access
 */

import { Router, Request, Response, NextFunction } from 'express';
import { 
  asyncHandler, 
  NotFoundError, 
  AuthorizationError,
  ValidationError,
} from '@naap/utils';
import type { PrismaClient } from '@naap/database';

// ============================================
// Types
// ============================================

interface TenantSummary {
  id: string;
  email: string | null;
  displayName: string | null;
  createdAt: Date;
  _count: {
    tenantInstalls: number;
    teams: number;
  };
}

interface TenantInstallationSummary {
  id: string;
  status: string;
  enabled: boolean;
  installedAt: Date;
  deployment: {
    id: string;
    package: {
      name: string;
      displayName: string;
    };
    version: {
      version: string;
    };
  };
}

interface AuditLogEntry {
  id: string;
  action: string;
  actorId: string;
  targetType: string;
  targetId: string;
  details: Record<string, unknown>;
  timestamp: Date;
}

// ============================================
// Middleware
// ============================================

/**
 * Require admin role to access these routes
 */
function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  const user = (req as any).user;
  if (!user) {
    throw new AuthorizationError('Authentication required');
  }
  
  // Check if user has admin role
  const roles = user.roles || [];
  if (!roles.includes('admin') && !roles.includes('superadmin')) {
    throw new AuthorizationError('Admin access required');
  }
  
  next();
}

// ============================================
// Route Factory
// ============================================

export function createAdminTenantRoutes(db: PrismaClient): Router {
  const router = Router();

  // All routes require admin
  router.use(requireAdmin);

  // ============================================
  // Tenant Management
  // ============================================

  /**
   * List all tenants with summary info
   */
  router.get('/tenants', asyncHandler(async (req: Request, res: Response) => {
    const { search, status, page = '1', limit = '20' } = req.query;
    
    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};
    
    if (search) {
      where.OR = [
        { email: { contains: search as string, mode: 'insensitive' } },
        { displayName: { contains: search as string, mode: 'insensitive' } },
      ];
    }

    const [tenants, total] = await Promise.all([
      db.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          displayName: true,
          createdAt: true,
          _count: {
            select: {
              tenantInstalls: true,
              teams: true,
            },
          },
        },
        skip,
        take: limitNum,
        orderBy: { createdAt: 'desc' },
      }),
      db.user.count({ where }),
    ]);

    res.json({
      success: true,
      tenants,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  }));

  /**
   * Get single tenant details
   */
  router.get('/tenants/:tenantId', asyncHandler(async (req: Request, res: Response) => {
    const { tenantId } = req.params;

    const tenant = await db.user.findUnique({
      where: { id: tenantId },
      include: {
        tenantInstalls: {
          include: {
            deployment: {
              include: {
                package: true,
                version: true,
              },
            },
            config: true,
          },
        },
        teams: {
          include: {
            team: true,
          },
        },
        _count: {
          select: {
            tenantInstalls: true,
            teams: true,
          },
        },
      },
    });

    if (!tenant) {
      throw new NotFoundError('Tenant');
    }

    res.json({
      success: true,
      tenant,
    });
  }));

  /**
   * Disable/enable a tenant
   */
  router.patch('/tenants/:tenantId/status', asyncHandler(async (req: Request, res: Response) => {
    const { tenantId } = req.params;
    const { enabled, reason } = req.body;

    if (typeof enabled !== 'boolean') {
      throw new ValidationError('enabled must be a boolean');
    }

    const tenant = await db.user.update({
      where: { id: tenantId },
      data: {
        // Assuming there's a status or enabled field - adjust as needed
        updatedAt: new Date(),
      },
    });

    // Log the action
    await logAdminAction(db, {
      action: enabled ? 'TENANT_ENABLED' : 'TENANT_DISABLED',
      actorId: (req as any).user.id,
      targetType: 'tenant',
      targetId: tenantId,
      details: { enabled, reason },
    });

    res.json({
      success: true,
      tenant,
    });
  }));

  // ============================================
  // Tenant Plugin Installations
  // ============================================

  /**
   * List all installations for a tenant
   */
  router.get('/tenants/:tenantId/installations', asyncHandler(async (req: Request, res: Response) => {
    const { tenantId } = req.params;

    const installations = await db.tenantPluginInstall.findMany({
      where: { userId: tenantId },
      include: {
        deployment: {
          include: {
            package: true,
            version: true,
          },
        },
        config: true,
      },
      orderBy: { installedAt: 'desc' },
    });

    res.json({
      success: true,
      installations,
    });
  }));

  /**
   * Get installation details with config history
   */
  router.get('/tenants/:tenantId/installations/:installId', asyncHandler(async (req: Request, res: Response) => {
    const { tenantId, installId } = req.params;

    const installation = await db.tenantPluginInstall.findFirst({
      where: { 
        id: installId,
        userId: tenantId,
      },
      include: {
        deployment: {
          include: {
            package: true,
            version: true,
          },
        },
        config: true,
      },
    });

    if (!installation) {
      throw new NotFoundError('Installation');
    }

    // Get config history (if you have a config history table)
    // For now, return current config
    res.json({
      success: true,
      installation,
      configHistory: [], // Would come from a ConfigHistory table
    });
  }));

  /**
   * Update tenant plugin config (admin override)
   */
  router.put('/tenants/:tenantId/installations/:installId/config', asyncHandler(async (req: Request, res: Response) => {
    const { tenantId, installId } = req.params;
    const { settings, reason } = req.body;

    const installation = await db.tenantPluginInstall.findFirst({
      where: { 
        id: installId,
        userId: tenantId,
      },
      include: { config: true },
    });

    if (!installation) {
      throw new NotFoundError('Installation');
    }

    // Update or create config
    const config = await db.tenantPluginConfig.upsert({
      where: { installId },
      create: {
        installId,
        settings: settings || {},
      },
      update: {
        settings: settings || {},
        updatedAt: new Date(),
      },
    });

    // Log the action
    await logAdminAction(db, {
      action: 'CONFIG_UPDATED',
      actorId: (req as any).user.id,
      targetType: 'tenant_installation',
      targetId: installId,
      details: { 
        tenantId,
        reason,
        previousSettings: installation.config?.settings,
        newSettings: settings,
      },
    });

    res.json({
      success: true,
      config,
    });
  }));

  /**
   * Approve/reject a plugin installation
   */
  router.post('/tenants/:tenantId/installations/:installId/approve', asyncHandler(async (req: Request, res: Response) => {
    const { tenantId, installId } = req.params;
    const { approved, reason } = req.body;

    if (typeof approved !== 'boolean') {
      throw new ValidationError('approved must be a boolean');
    }

    const installation = await db.tenantPluginInstall.update({
      where: { id: installId },
      data: {
        status: approved ? 'active' : 'rejected',
        enabled: approved,
      },
    });

    // Log the action
    await logAdminAction(db, {
      action: approved ? 'INSTALLATION_APPROVED' : 'INSTALLATION_REJECTED',
      actorId: (req as any).user.id,
      targetType: 'tenant_installation',
      targetId: installId,
      details: { tenantId, approved, reason },
    });

    res.json({
      success: true,
      installation,
    });
  }));

  /**
   * Force uninstall a plugin from tenant
   */
  router.delete('/tenants/:tenantId/installations/:installId', asyncHandler(async (req: Request, res: Response) => {
    const { tenantId, installId } = req.params;
    const { reason } = req.body;

    const installation = await db.tenantPluginInstall.findFirst({
      where: { 
        id: installId,
        userId: tenantId,
      },
    });

    if (!installation) {
      throw new NotFoundError('Installation');
    }

    // Delete the installation
    await db.tenantPluginInstall.delete({
      where: { id: installId },
    });

    // Log the action
    await logAdminAction(db, {
      action: 'INSTALLATION_REMOVED',
      actorId: (req as any).user.id,
      targetType: 'tenant_installation',
      targetId: installId,
      details: { tenantId, reason },
    });

    res.json({
      success: true,
      message: 'Installation removed',
    });
  }));

  // ============================================
  // Audit Logs
  // ============================================

  /**
   * Get audit logs for admin actions
   */
  router.get('/audit-logs', asyncHandler(async (req: Request, res: Response) => {
    const { 
      action, 
      actorId, 
      targetType, 
      targetId,
      startDate,
      endDate,
      page = '1', 
      limit = '50' 
    } = req.query;

    const pageNum = parseInt(page as string, 10);
    const limitNum = parseInt(limit as string, 10);
    const skip = (pageNum - 1) * limitNum;

    const where: any = {};
    
    if (action) where.action = action;
    if (actorId) where.actorId = actorId;
    if (targetType) where.targetType = targetType;
    if (targetId) where.targetId = targetId;
    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp.gte = new Date(startDate as string);
      if (endDate) where.timestamp.lte = new Date(endDate as string);
    }

    // Note: This assumes an AdminAuditLog model exists
    // You may need to create this model in the Prisma schema
    const logs: AuditLogEntry[] = []; // Would be: await db.adminAuditLog.findMany(...)
    const total = 0; // Would be: await db.adminAuditLog.count({ where })

    res.json({
      success: true,
      logs,
      pagination: {
        page: pageNum,
        limit: limitNum,
        total,
        pages: Math.ceil(total / limitNum),
      },
    });
  }));

  /**
   * Export audit logs
   */
  router.get('/audit-logs/export', asyncHandler(async (req: Request, res: Response) => {
    const { format = 'json', startDate, endDate } = req.query;

    // Build query
    const where: any = {};
    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp.gte = new Date(startDate as string);
      if (endDate) where.timestamp.lte = new Date(endDate as string);
    }

    // Fetch logs (limited to prevent huge exports)
    const logs: AuditLogEntry[] = []; // Would fetch from db

    if (format === 'csv') {
      // Convert to CSV
      const csv = convertToCSV(logs);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${Date.now()}.csv"`);
      res.send(csv);
    } else {
      res.json({
        success: true,
        logs,
        exportedAt: new Date().toISOString(),
      });
    }
  }));

  // ============================================
  // Health & Metrics (per tenant)
  // ============================================

  /**
   * Get health status for a tenant's plugins
   */
  router.get('/tenants/:tenantId/health', asyncHandler(async (req: Request, res: Response) => {
    const { tenantId } = req.params;

    const installations = await db.tenantPluginInstall.findMany({
      where: { userId: tenantId },
      include: {
        deployment: {
          select: {
            healthStatus: true,
            package: {
              select: { name: true, displayName: true },
            },
          },
        },
      },
    });

    const health = installations.map(inst => ({
      installId: inst.id,
      pluginName: inst.deployment.package.name,
      displayName: inst.deployment.package.displayName,
      status: inst.status,
      enabled: inst.enabled,
      healthStatus: inst.deployment.healthStatus,
    }));

    const summary = {
      total: health.length,
      healthy: health.filter(h => h.healthStatus === 'healthy').length,
      unhealthy: health.filter(h => h.healthStatus === 'unhealthy').length,
      unknown: health.filter(h => !h.healthStatus || h.healthStatus === 'unknown').length,
    };

    res.json({
      success: true,
      tenantId,
      health,
      summary,
    });
  }));

  return router;
}

// ============================================
// Helpers
// ============================================

/**
 * Log an admin action for audit trail
 */
async function logAdminAction(
  db: PrismaClient,
  entry: {
    action: string;
    actorId: string;
    targetType: string;
    targetId: string;
    details: Record<string, unknown>;
  }
): Promise<void> {
  // In a real implementation, this would write to an AdminAuditLog table
  // For now, just log to console
  console.log('[AdminAudit]', JSON.stringify({
    ...entry,
    timestamp: new Date().toISOString(),
  }));
  
  // Would be:
  // await db.adminAuditLog.create({ data: { ...entry, timestamp: new Date() } });
}

/**
 * Convert audit logs to CSV format
 */
function convertToCSV(logs: AuditLogEntry[]): string {
  if (logs.length === 0) {
    return 'id,action,actorId,targetType,targetId,timestamp,details\n';
  }

  const header = 'id,action,actorId,targetType,targetId,timestamp,details\n';
  const rows = logs.map(log => 
    `${log.id},${log.action},${log.actorId},${log.targetType},${log.targetId},${log.timestamp.toISOString()},"${JSON.stringify(log.details).replace(/"/g, '""')}"`
  ).join('\n');

  return header + rows;
}
