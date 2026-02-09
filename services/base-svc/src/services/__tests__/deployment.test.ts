/**
 * Deployment Service Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  provisionPluginInfrastructure,
  performPostInstallHealthCheck,
  rollbackInstallation,
} from '../pluginProvisioning.js';
import * as portAllocator from '../portAllocator.js';

// Mock port allocator
vi.mock('../portAllocator.js', () => ({
  allocatePort: vi.fn().mockResolvedValue(4100),
  releasePort: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('provisionPluginInfrastructure', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should provision infrastructure with backend port', async () => {
    const manifest = {
      name: 'test-plugin',
      version: '1.0.0',
      backend: { entry: './server.js', port: 4100 },
    };

    const result = await provisionPluginInfrastructure('test-plugin', manifest);

    expect(result.status).toBe('provisioned');
    expect(result.containerPort).toBe(4100);
    expect(portAllocator.allocatePort).toHaveBeenCalledWith('test-plugin');
  });

  it('should provision database if specified', async () => {
    const manifest = {
      name: 'db-plugin',
      version: '1.0.0',
      backend: { entry: './server.js' },
      database: { type: 'postgresql' },
    };

    const result = await provisionPluginInfrastructure('db-plugin', manifest);

    expect(result.status).toBe('provisioned');
    expect(result.databaseName).toBe('plugin_db_plugin');
  });

  it('should provision without backend for frontend-only plugins', async () => {
    const manifest = {
      name: 'frontend-plugin',
      version: '1.0.0',
      frontend: { entry: './frontend/dist/production/frontend-plugin.js' },
    };

    const result = await provisionPluginInfrastructure('frontend-plugin', manifest);

    expect(result.status).toBe('provisioned');
    expect(result.containerPort).toBeUndefined();
    expect(portAllocator.allocatePort).not.toHaveBeenCalled();
  });

  it('should set containerId when backend image provided', async () => {
    const manifest = {
      name: 'test-plugin',
      version: '1.0.0',
      backend: { entry: './server.js' },
    };

    const result = await provisionPluginInfrastructure('test-plugin', manifest, 'my-image:1.0');

    expect(result.status).toBe('provisioned');
    expect(result.containerId).toBeDefined();
  });
});

describe('performPostInstallHealthCheck', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should pass health check for healthy backend', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ status: 'healthy' }),
    });

    const provision = {
      pluginName: 'test-plugin',
      containerPort: 4100,
      status: 'provisioned' as const,
    };

    const result = await performPostInstallHealthCheck('test-plugin', provision);

    expect(result.success).toBe(true);
    expect(result.checks[0].component).toBe('backend');
    expect(result.checks[0].healthy).toBe(true);
  });

  it('should fail health check for HTTP 500', async () => {
    // Mock a server error response (no retries for actual 500 response)
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ status: 'error' }),
    });

    const provision = {
      pluginName: 'test-plugin',
      containerPort: 4100,
      status: 'provisioned' as const,
    };

    const result = await performPostInstallHealthCheck('test-plugin', provision);

    expect(result.success).toBe(false);
    expect(result.error).toContain('Backend');
  });

  it('should check database if provisioned', async () => {
    const provision = {
      pluginName: 'db-plugin',
      databaseName: 'plugin_db_plugin',
      status: 'provisioned' as const,
    };

    const result = await performPostInstallHealthCheck('db-plugin', provision);

    expect(result.success).toBe(true);
    expect(result.checks.some(c => c.component === 'database')).toBe(true);
  });

  it('should pass for frontend-only plugins', async () => {
    const provision = {
      pluginName: 'frontend-plugin',
      status: 'provisioned' as const,
    };

    const result = await performPostInstallHealthCheck('frontend-plugin', provision);

    expect(result.success).toBe(true);
    expect(result.checks).toHaveLength(0);
  });
});

describe('rollbackInstallation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should release port on rollback', async () => {
    const provision = {
      pluginName: 'test-plugin',
      containerPort: 4100,
      status: 'provisioned' as const,
    };

    await rollbackInstallation('test-plugin', provision);

    expect(portAllocator.releasePort).toHaveBeenCalledWith('test-plugin');
  });

  it('should handle rollback without provision info', async () => {
    await rollbackInstallation('test-plugin');

    expect(portAllocator.releasePort).toHaveBeenCalledWith('test-plugin');
  });

  it('should log container cleanup', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    
    const provision = {
      pluginName: 'test-plugin',
      containerId: 'container_123',
      status: 'provisioned' as const,
    };

    await rollbackInstallation('test-plugin', provision);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Would stop container')
    );
  });

  it('should log database cleanup', async () => {
    const consoleSpy = vi.spyOn(console, 'log');
    
    const provision = {
      pluginName: 'db-plugin',
      databaseName: 'plugin_db_plugin',
      status: 'provisioned' as const,
    };

    await rollbackInstallation('db-plugin', provision);

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('Would drop database')
    );
  });
});
