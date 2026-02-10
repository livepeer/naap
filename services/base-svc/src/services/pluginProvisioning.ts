/**
 * Plugin Provisioning Service
 * 
 * Handles infrastructure provisioning, backend deployment, and cleanup:
 * - Dynamic port allocation
 * - Database provisioning (if needed)
 * - Backend container deployment
 * - Post-installation health checks
 * - Rollback on failure
 */

import { allocatePort, releasePort } from './portAllocator';
import type { PluginManifest, DeepPartial } from '@naap/types';

export interface ProvisionResult {
  pluginName: string;
  containerPort?: number;
  frontendPort?: number;
  databaseName?: string;
  containerId?: string;
  status: 'provisioned' | 'failed';
  error?: string;
}

export interface HealthCheckResult {
  success: boolean;
  checks: HealthCheck[];
  error?: string;
}

export interface HealthCheck {
  component: 'frontend' | 'backend' | 'database';
  healthy: boolean;
  message: string;
  responseTime?: number;
}

// Re-export PluginManifest for consumers that imported it from here
export type { PluginManifest };

/**
 * Provision infrastructure for a plugin
 */
export async function provisionPluginInfrastructure(
  pluginName: string,
  manifest: DeepPartial<PluginManifest>,
  backendImage?: string
): Promise<ProvisionResult> {
  try {
    const result: ProvisionResult = {
      pluginName,
      status: 'provisioned',
    };

    // 1. Allocate ports for backend
    if (manifest.backend) {
      result.containerPort = await allocatePort(pluginName);
    }

    // 2. Provision database if needed
    if (manifest.database) {
      result.databaseName = `plugin_${pluginName.replace(/-/g, '_')}`;
      // In production, would call databaseManager.createDatabase()
      console.log(`[provisioning] Would provision database: ${result.databaseName}`);
    }

    // 3. Deploy backend container if image provided
    if (backendImage && manifest.backend) {
      // In production, would call containerOrchestrator.deploy()
      console.log(`[provisioning] Would deploy backend container: ${backendImage} on port ${result.containerPort}`);
      result.containerId = `container_${pluginName}_${Date.now()}`;
    }

    console.log(`[provisioning] Provisioned infrastructure for ${pluginName}:`, result);
    return result;

  } catch (error) {
    console.error(`[provisioning] Failed to provision ${pluginName}:`, error);
    
    // Cleanup any partial allocations
    releasePort(pluginName);
    
    return {
      pluginName,
      status: 'failed',
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Perform post-installation health checks
 */
export async function performPostInstallHealthCheck(
  pluginName: string,
  provision: ProvisionResult
): Promise<HealthCheckResult> {
  const checks: HealthCheck[] = [];

  // Check backend health if deployed
  if (provision.containerPort) {
    const backendHealth = await checkBackendHealth(
      `http://localhost:${provision.containerPort}/healthz`
    );
    checks.push({
      component: 'backend',
      ...backendHealth,
    });

    if (!backendHealth.healthy) {
      return {
        success: false,
        checks,
        error: 'Backend health check failed',
      };
    }
  }

  // Check database connectivity if provisioned
  if (provision.databaseName) {
    // In production, would check actual database connection
    checks.push({
      component: 'database',
      healthy: true,
      message: 'Database connection available',
    });
  }

  return {
    success: checks.every(c => c.healthy),
    checks,
  };
}

/**
 * Check backend health endpoint
 */
async function checkBackendHealth(
  url: string,
  maxAttempts: number = 10,
  delayMs: number = 2000
): Promise<{ healthy: boolean; message: string; responseTime?: number }> {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const startTime = Date.now();
    
    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: AbortSignal.timeout(5000),
      });

      const responseTime = Date.now() - startTime;

      if (response.ok) {
        const data = await response.json().catch(() => ({}));
        const status = data.status || 'ok';
        
        if (status === 'healthy' || status === 'ok') {
          return {
            healthy: true,
            message: 'Backend is healthy',
            responseTime,
          };
        }
      }

      // If we got a response but it's not healthy, don't retry - backend is up but unhealthy
      if (response.status >= 400 && response.status < 600) {
        return {
          healthy: false,
          message: `Backend unhealthy: HTTP ${response.status}`,
          responseTime,
        };
      }
    } catch (error) {
      // Network error - continue to next attempt
      if (attempt < maxAttempts - 1) {
        await sleep(delayMs);
      }
    }
  }

  return {
    healthy: false,
    message: `Backend not responding after ${maxAttempts} attempts`,
  };
}

/**
 * Rollback a failed installation
 */
export async function rollbackInstallation(
  pluginName: string,
  provision?: ProvisionResult
): Promise<void> {
  console.log(`[provisioning] Rolling back installation for ${pluginName}`);

  try {
    // 1. Stop and remove container
    if (provision?.containerId) {
      console.log(`[provisioning] Would stop container: ${provision.containerId}`);
      // In production: await containerOrchestrator.stop(containerId)
      // In production: await containerOrchestrator.remove(containerId)
    }

    // 2. Drop database if created
    if (provision?.databaseName) {
      console.log(`[provisioning] Would drop database: ${provision.databaseName}`);
      // In production: await databaseManager.dropDatabase(databaseName)
    }

    // 3. Release allocated ports
    releasePort(pluginName);

    console.log(`[provisioning] Rollback completed for ${pluginName}`);
  } catch (error) {
    console.error(`[provisioning] Rollback failed for ${pluginName}:`, error);
    // Log but don't throw - best effort rollback
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
