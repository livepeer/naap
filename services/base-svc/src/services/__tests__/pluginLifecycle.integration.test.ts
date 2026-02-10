/**
 * Plugin Lifecycle Integration Tests
 * 
 * End-to-end tests for the complete plugin lifecycle:
 * Build -> Package -> Validate -> Publish -> Install -> Run
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { verifyPublish, validatePublishManifest, verifyUrlAccessible } from '../publishVerification.js';
import { provisionPluginInfrastructure, rollbackInstallation, performPostInstallHealthCheck } from '../pluginProvisioning.js';
import { ProcessMonitor } from '../processMonitor.js';
import * as portAllocator from '../portAllocator.js';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock port allocator
vi.mock('../portAllocator.js', () => ({
  allocatePort: vi.fn().mockResolvedValue(4200),
  releasePort: vi.fn(),
}));

// Mock database
vi.mock('../../db/client.js', () => ({
  db: {
    pluginPackage: {
      findUnique: vi.fn().mockResolvedValue({ id: '1', name: 'test-plugin' }),
    },
    pluginInstallation: {
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      findMany: vi.fn().mockResolvedValue([]),
    },
  },
}));

describe('Plugin Lifecycle Integration', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    vi.clearAllMocks();
  });

  describe('Complete Frontend-Only Plugin Lifecycle', () => {
    const frontendManifest = {
      name: 'ui-widget',
      version: '1.0.0',
      displayName: 'UI Widget',
      description: 'A simple UI widget',
      frontend: {
        entry: './frontend/dist/production/ui-widget.js',
        routes: ['/widget'],
      },
    };

    it('should validate manifest successfully', () => {
      const result = validatePublishManifest(frontendManifest);
      
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should verify frontend URL accessibility', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const result = await verifyUrlAccessible('http://localhost:3000/cdn/plugins/ui-widget/1.0.0/ui-widget.js');

      expect(result.accessible).toBe(true);
    });

    it('should pass pre-publish verification', async () => {
      mockFetch.mockResolvedValueOnce({ ok: true });

      const result = await verifyPublish({
        manifest: frontendManifest,
        frontendUrl: 'http://localhost:3000/cdn/plugins/ui-widget/1.0.0/ui-widget.js',
      });

      expect(result.valid).toBe(true);
      expect(result.checks.every(c => c.passed)).toBe(true);
    });

    it('should provision without backend port', async () => {
      const provision = await provisionPluginInfrastructure('ui-widget', frontendManifest);

      expect(provision.status).toBe('provisioned');
      expect(provision.containerPort).toBeUndefined();
      expect(portAllocator.allocatePort).not.toHaveBeenCalled();
    });
  });

  describe('Complete Full-Stack Plugin Lifecycle', () => {
    const fullStackManifest = {
      name: 'data-manager',
      version: '2.0.0',
      displayName: 'Data Manager',
      description: 'Manages application data',
      frontend: {
        entry: './frontend/dist/production/data-manager.js',
        routes: ['/data-manager'],
      },
      backend: {
        entry: './backend/src/server.ts',
        port: 4200,
        healthCheck: '/healthz',
      },
      database: {
        type: 'postgresql' as const,
      },
    };

    it('should validate full-stack manifest', () => {
      const result = validatePublishManifest(fullStackManifest);
      
      expect(result.valid).toBe(true);
    });

    it('should fail verification when backend not accessible', async () => {
      // Frontend accessible
      mockFetch.mockResolvedValueOnce({ ok: true });
      // Docker image not found
      mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

      const result = await verifyPublish({
        manifest: fullStackManifest,
        frontendUrl: 'http://localhost:3000/cdn/plugins/data-manager/2.0.0/data-manager.js',
        backendImage: 'nonexistent:latest',
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'DOCKER_IMAGE_NOT_FOUND')).toBe(true);
    });

    it('should provision with backend and database', async () => {
      const provision = await provisionPluginInfrastructure('data-manager', fullStackManifest);

      expect(provision.status).toBe('provisioned');
      expect(provision.containerPort).toBe(4200);
      expect(provision.databaseName).toBe('plugin_data_manager');
      expect(portAllocator.allocatePort).toHaveBeenCalledWith('data-manager');
    });

    it('should rollback on failed health check', async () => {
      // Provision succeeds
      const provision = await provisionPluginInfrastructure('data-manager', fullStackManifest);
      
      // Health check fails
      mockFetch.mockResolvedValue({ ok: false, status: 500 });
      const healthResult = await performPostInstallHealthCheck('data-manager', provision);

      expect(healthResult.success).toBe(false);

      // Rollback
      await rollbackInstallation('data-manager', provision);

      expect(portAllocator.releasePort).toHaveBeenCalledWith('data-manager');
    });
  });

  describe('Error Handling Scenarios', () => {
    it('should reject manifest with invalid name format', () => {
      const result = validatePublishManifest({
        name: 'Invalid_Name',
        version: '1.0.0',
        frontend: { entry: './frontend/dist/production/test.js', routes: ['/test'] },
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_NAME')).toBe(true);
    });

    it('should reject manifest with invalid version', () => {
      const result = validatePublishManifest({
        name: 'test-plugin',
        version: 'not-semver',
        frontend: { entry: './frontend/dist/production/test.js', routes: ['/test'] },
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'INVALID_VERSION')).toBe(true);
    });

    it('should reject manifest with no components', () => {
      const result = validatePublishManifest({
        name: 'empty-plugin',
        version: '1.0.0',
      });

      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'NO_COMPONENTS')).toBe(true);
    });

    it('should handle network timeout during URL verification', async () => {
      const abortError = new Error('Timeout');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      const result = await verifyUrlAccessible('http://localhost:3100/slow', 100);

      expect(result.accessible).toBe(false);
      expect(result.error).toContain('timed out');
    });
  });

  describe('Process Monitoring Integration', () => {
    it('should detect unhealthy plugin and update status', async () => {
      const monitor = new ProcessMonitor({
        checkIntervalMs: 100,
        maxFailedChecks: 2,
        healthTimeout: 50,
      });

      // First check healthy
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ status: 'healthy' }),
      });

      monitor.startMonitoring('test-plugin', 4200);
      await monitor.triggerCheck('test-plugin');

      expect(monitor.getStatus('test-plugin')?.status).toBe('healthy');

      // Second check unhealthy
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
      });

      await monitor.triggerCheck('test-plugin');

      expect(monitor.getStatus('test-plugin')?.status).toBe('unhealthy');
      expect(monitor.getStatus('test-plugin')?.failedChecks).toBe(1);

      monitor.stopAll();
    });
  });
});
