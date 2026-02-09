/**
 * Tenant Context Middleware
 * Extracts tenant information from JWT and adds it to request context
 */

import { Request, Response, NextFunction } from 'express';
import { PrismaClient } from '@naap/database';

export interface TenantContext {
  tenantId: string;        // User ID
  installId: string;       // TenantPluginInstall ID
  pluginName: string;      // Plugin name
  config: Record<string, unknown>;  // Tenant-specific config
  deployment: {
    id: string;
    frontendUrl: string | null;
    backendUrl: string | null;
  };
}

// Extend Express Request to include tenant context and user
declare global {
  namespace Express {
    interface Request {
      tenant?: TenantContext;
      user?: {
        id: string;
        email?: string | null;
        displayName?: string | null;
        roles?: string[];
      };
    }
  }
}

/**
 * Create tenant context middleware
 * This middleware extracts tenant info from the authenticated user and plugin name
 */
export function createTenantMiddleware(prisma: PrismaClient) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      // Skip if no user (not authenticated)
      if (!req.user || !(req.user as { id?: string }).id) {
        return next();
      }

      const userId = (req.user as { id: string }).id;

      // Extract plugin name from path
      // Expects paths like: /api/v1/plugins/:pluginName/*
      const pathMatch = req.path.match(/^\/api\/v1\/plugins\/([^/]+)/);
      if (!pathMatch) {
        return next();
      }

      const pluginName = pathMatch[1];

      // Find tenant installation
      const tenantInstall = await prisma.tenantPluginInstall.findFirst({
        where: {
          userId,
          status: 'active',
          deployment: {
            package: {
              name: pluginName,
            },
          },
        },
        include: {
          config: true,
          deployment: {
            include: {
              package: true,
            },
          },
        },
      });

      if (!tenantInstall) {
        return res.status(403).json({
          error: 'Plugin not installed for this user',
          code: 'PLUGIN_NOT_INSTALLED',
        });
      }

      // Check if deployment is running
      if (tenantInstall.deployment.status !== 'running') {
        return res.status(503).json({
          error: 'Plugin is not running',
          code: 'PLUGIN_NOT_RUNNING',
          status: tenantInstall.deployment.status,
        });
      }

      // Build tenant context
      req.tenant = {
        tenantId: userId,
        installId: tenantInstall.id,
        pluginName,
        config: (tenantInstall.config?.settings as Record<string, unknown>) || {},
        deployment: {
          id: tenantInstall.deployment.id,
          frontendUrl: tenantInstall.deployment.frontendUrl,
          backendUrl: tenantInstall.deployment.backendUrl,
        },
      };

      next();
    } catch (error) {
      console.error('Tenant middleware error:', error);
      res.status(500).json({
        error: 'Failed to resolve tenant context',
        code: 'TENANT_CONTEXT_ERROR',
      });
    }
  };
}

/**
 * Middleware to require tenant context
 * Use after createTenantMiddleware for routes that require plugin installation
 */
export function requireTenant(req: Request, res: Response, next: NextFunction) {
  if (!req.tenant) {
    return res.status(403).json({
      error: 'Tenant context required',
      code: 'TENANT_REQUIRED',
    });
  }
  next();
}

/**
 * Helper to get tenant config value with fallback
 */
export function getTenantConfigValue<T>(
  tenant: TenantContext,
  key: string,
  defaultValue: T
): T {
  if (tenant.config && key in tenant.config) {
    return tenant.config[key] as T;
  }
  return defaultValue;
}

/**
 * Middleware to forward tenant context headers to plugin backends
 * Adds X-Tenant-* headers for plugin backend consumption
 */
export function forwardTenantHeaders(req: Request, _res: Response, next: NextFunction) {
  if (req.tenant) {
    // Add tenant context headers for forwarding to plugin backends
    req.headers['x-tenant-id'] = req.tenant.tenantId;
    req.headers['x-tenant-install-id'] = req.tenant.installId;
    req.headers['x-tenant-plugin'] = req.tenant.pluginName;
    req.headers['x-tenant-config'] = JSON.stringify(req.tenant.config);
  }
  next();
}

/**
 * Parse tenant context from forwarded headers
 * For use in plugin backends that receive proxied requests
 */
export function parseTenantFromHeaders(req: Request): TenantContext | null {
  const tenantId = req.headers['x-tenant-id'] as string;
  const installId = req.headers['x-tenant-install-id'] as string;
  const pluginName = req.headers['x-tenant-plugin'] as string;
  const configStr = req.headers['x-tenant-config'] as string;

  if (!tenantId || !installId || !pluginName) {
    return null;
  }

  let config: Record<string, unknown> = {};
  try {
    if (configStr) {
      config = JSON.parse(configStr);
    }
  } catch {
    // Invalid config JSON, use empty object
  }

  return {
    tenantId,
    installId,
    pluginName,
    config,
    deployment: {
      id: '', // Not available from headers
      frontendUrl: null,
      backendUrl: null,
    },
  };
}
