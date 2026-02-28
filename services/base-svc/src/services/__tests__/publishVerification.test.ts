/**
 * Publish Verification Service Tests
 * 
 * Tests for URL accessibility, Docker image verification, and route validation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  verifyUrlAccessible,
  verifyDockerImage,
  validatePublishManifest,
  verifyPublish,
} from '../publishVerification.js';

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('verifyUrlAccessible', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should return accessible true for 200 response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true });

    const result = await verifyUrlAccessible('https://cdn.example.com/plugins/my-plugin/1.0.0/my-plugin.js');

    expect(result.accessible).toBe(true);
    expect(result.responseTime).toBeDefined();
  });

  it('should return accessible false for 404 response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' });

    const result = await verifyUrlAccessible('https://cdn.example.com/missing.js');

    expect(result.accessible).toBe(false);
    expect(result.error).toContain('404');
  });

  it('should return accessible false for 500 response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 500, statusText: 'Internal Server Error' });

    const result = await verifyUrlAccessible('https://cdn.example.com/error.js');

    expect(result.accessible).toBe(false);
    expect(result.error).toContain('500');
  });

  it('should handle network errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await verifyUrlAccessible('https://cdn.example.com/plugins/my-plugin/1.0.0/my-plugin.js');

    expect(result.accessible).toBe(false);
    expect(result.error).toBe('Network error');
  });

  it('should handle timeout', async () => {
    const abortError = new Error('Timeout');
    abortError.name = 'AbortError';
    mockFetch.mockRejectedValueOnce(abortError);

    const result = await verifyUrlAccessible('https://cdn.example.com/plugins/my-plugin/1.0.0/my-plugin.js', 100);

    expect(result.accessible).toBe(false);
    expect(result.error).toContain('timed out');
  });
});

describe('verifyDockerImage', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should return exists true for valid image', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => '10485760' }, // 10MB
    });

    const result = await verifyDockerImage('my-plugin:1.0.0');

    expect(result.exists).toBe(true);
  });

  it('should return exists false for 404', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const result = await verifyDockerImage('nonexistent:latest');

    expect(result.exists).toBe(false);
    expect(result.error).toContain('not found');
  });

  it('should assume exists true for 401 (private image)', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

    const result = await verifyDockerImage('private/image:latest');

    // Private images assumed to exist
    expect(result.exists).toBe(true);
  });

  it('should handle ghcr.io registry', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      headers: { get: () => null },
    });

    const result = await verifyDockerImage('ghcr.io/owner/image:v1');

    expect(result.exists).toBe(true);
  });

  it('should handle network errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Connection refused'));

    const result = await verifyDockerImage('my-image:latest');

    expect(result.exists).toBe(false);
    expect(result.error).toContain('Connection refused');
  });
});

describe('validatePublishManifest', () => {
  it('should pass for valid manifest', () => {
    const manifest = {
      name: 'my-plugin',
      version: '1.0.0',
      displayName: 'My Plugin',
      description: 'A test plugin',
      frontend: {
        entry: './frontend/dist/production/my-plugin.js',
        routes: ['/plugins/my-plugin', '/plugins/my-plugin/*'],
      },
    };

    const result = validatePublishManifest(manifest);

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail for missing name', () => {
    const manifest = {
      version: '1.0.0',
      frontend: { entry: './frontend/dist/production/plugin.js', routes: ['/plugins/plugin'] },
    };

    // @ts-ignore - testing invalid input
    const result = validatePublishManifest(manifest);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'MISSING_NAME')).toBe(true);
  });

  it('should fail for invalid name format', () => {
    const manifest = {
      name: 'MyPlugin', // Should be kebab-case
      version: '1.0.0',
      frontend: { entry: './frontend/dist/production/plugin.js', routes: ['/plugins/plugin'] },
    };

    const result = validatePublishManifest(manifest);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'INVALID_NAME')).toBe(true);
  });

  it('should fail for missing version', () => {
    const manifest = {
      name: 'my-plugin',
      frontend: { entry: './frontend/dist/production/plugin.js', routes: ['/plugins/plugin'] },
    };

    // @ts-ignore - testing invalid input
    const result = validatePublishManifest(manifest);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'MISSING_VERSION')).toBe(true);
  });

  it('should fail for invalid version format', () => {
    const manifest = {
      name: 'my-plugin',
      version: 'v1', // Should be semver
      frontend: { entry: './frontend/dist/production/plugin.js', routes: ['/plugins/plugin'] },
    };

    const result = validatePublishManifest(manifest);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'INVALID_VERSION')).toBe(true);
  });

  it('should fail for missing frontend and backend', () => {
    const manifest = {
      name: 'my-plugin',
      version: '1.0.0',
    };

    const result = validatePublishManifest(manifest);

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'NO_COMPONENTS')).toBe(true);
  });

  it('should warn for missing description', () => {
    const manifest = {
      name: 'my-plugin',
      version: '1.0.0',
      frontend: { entry: './frontend/dist/production/plugin.js', routes: ['/plugins/plugin'] },
    };

    const result = validatePublishManifest(manifest);

    expect(result.warnings.some(w => w.code === 'MISSING_DESCRIPTION')).toBe(true);
  });

  describe('route validation', () => {
    const validManifest = (routes: string[]) => ({
      name: 'my-plugin',
      version: '1.0.0',
      displayName: 'My Plugin',
      description: 'Test',
      frontend: {
        entry: './frontend/dist/production/my-plugin.js',
        routes,
      },
    });

    it('should accept routes under /plugins/{name}', () => {
      const result = validatePublishManifest(
        validManifest(['/plugins/my-plugin', '/plugins/my-plugin/*'])
      );
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject top-level routes with ROUTE_NAMESPACE_VIOLATION', () => {
      const result = validatePublishManifest(
        validManifest(['/wallet', '/wallet/*'])
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'ROUTE_NAMESPACE_VIOLATION')).toBe(true);
    });

    it('should reject reserved paths with ROUTE_RESERVED_PATH', () => {
      const result = validatePublishManifest(
        validManifest(['/settings'])
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'ROUTE_RESERVED_PATH')).toBe(true);
    });

    it('should reject /admin as reserved', () => {
      const result = validatePublishManifest(
        validManifest(['/admin'])
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'ROUTE_RESERVED_PATH')).toBe(true);
    });

    it('should accept plugins with no routes (headless)', () => {
      const manifest = {
        name: 'my-provider',
        version: '1.0.0',
        frontend: { entry: './frontend/dist/production/provider.js', routes: [] as string[] },
      };
      const result = validatePublishManifest(manifest);
      expect(result.valid).toBe(true);
    });

    it('should accept plugins with no frontend at all', () => {
      const manifest = {
        name: 'my-backend',
        version: '1.0.0',
        backend: { entry: './server.js', port: 4001 },
      };
      const result = validatePublishManifest(manifest);
      expect(result.valid).toBe(true);
    });

    it('should reject bare /plugins/ route', () => {
      const result = validatePublishManifest(
        validManifest(['/plugins/'])
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'ROUTE_NAMESPACE_VIOLATION')).toBe(true);
    });

    it('should reject routes under another plugin namespace', () => {
      const result = validatePublishManifest(
        validManifest(['/plugins/other-plugin'])
      );
      expect(result.valid).toBe(false);
      expect(result.errors.some(e => e.code === 'ROUTE_NAMESPACE_VIOLATION')).toBe(true);
    });
  });
});

describe('verifyPublish', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it('should pass all checks for valid publish', async () => {
    // Mock URL check
    mockFetch.mockResolvedValueOnce({ ok: true });

    const result = await verifyPublish({
      manifest: {
        name: 'my-plugin',
        version: '1.0.0',
        displayName: 'My Plugin',
        description: 'Test',
        frontend: { entry: './frontend/dist/production/plugin.js', routes: ['/plugins/my-plugin'] },
      },
      frontendUrl: 'https://cdn.example.com/plugins/my-plugin/1.0.0/my-plugin.js',
    });

    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.checks.length).toBeGreaterThan(0);
    expect(result.checks.every(c => c.passed)).toBe(true);
  });

  it('should fail if frontend URL not accessible', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' });

    const result = await verifyPublish({
      manifest: {
        name: 'my-plugin',
        version: '1.0.0',
        frontend: { entry: './frontend/dist/production/plugin.js', routes: ['/plugins/my-plugin'] },
      },
      frontendUrl: 'https://cdn.example.com/missing.js',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'FRONTEND_NOT_ACCESSIBLE')).toBe(true);
  });

  it('should fail if Docker image not found', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 });

    const result = await verifyPublish({
      manifest: {
        name: 'my-plugin',
        version: '1.0.0',
        backend: { entry: './server.js', port: 4001 },
      },
      backendImage: 'nonexistent:latest',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.some(e => e.code === 'DOCKER_IMAGE_NOT_FOUND')).toBe(true);
  });

  it('should aggregate manifest and URL errors', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404, statusText: 'Not Found' });

    const result = await verifyPublish({
      manifest: {
        name: 'MyPlugin', // Invalid
        version: 'v1', // Invalid
      },
      frontendUrl: 'https://cdn.example.com/missing.js',
    });

    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThan(1);
    expect(result.errors.some(e => e.code === 'INVALID_NAME')).toBe(true);
    expect(result.errors.some(e => e.code === 'FRONTEND_NOT_ACCESSIBLE')).toBe(true);
  });

  it('should skip URL check when skipUrlCheck is true', async () => {
    const result = await verifyPublish({
      manifest: {
        name: 'my-plugin',
        version: '1.0.0',
        frontend: { entry: './frontend/dist/production/plugin.js', routes: ['/plugins/my-plugin'] },
      },
      frontendUrl: 'https://cdn.example.com/plugins/my-plugin/1.0.0/my-plugin.js',
      skipUrlCheck: true,
    });

    // Should not have called fetch
    expect(mockFetch).not.toHaveBeenCalled();
    expect(result.valid).toBe(true);
  });
});
