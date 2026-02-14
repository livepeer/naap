/**
 * Plugin Tester Service Tests
 * 
 * Tests for frontend UMD bundle loading and backend health check validation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { lookup } from 'node:dns/promises';
import {
  testFrontendLoading,
  testBackendHealth,
  testPlugin,
  type FrontendTestResult,
  type BackendTestResult,
} from '../pluginTester.js';

vi.mock('node:dns/promises', () => ({
  lookup: vi.fn(),
}));

// Mock fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;
const mockLookup = vi.mocked(lookup);

describe('testFrontendLoading', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockLookup.mockReset();
    mockLookup.mockImplementation(async () => [{ address: '93.184.216.34', family: 4 }] as any);
  });

  it('should pass for valid UMD bundle', async () => {
    const validContent = `
      (function(global, factory) {
        typeof exports === 'object' && typeof module !== 'undefined' ? factory(exports) :
        typeof define === 'function' && define.amd ? define(['exports'], factory) :
        (global = typeof globalThis !== 'undefined' ? globalThis : global || self,
         factory(global["NaapPluginMyWidget"] = {}));
      })(this, (function(exports) {
        exports.mount = function(container, context) {};
      }));
    `;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(validContent),
    });

    const result = await testFrontendLoading('https://plugins.example.com/cdn/plugins/my-widget/1.0.0/my-widget.js');

    expect(result.success).toBe(true);
    expect(result.bundleValid).toBe(true);
    expect(result.globalName).toBe('NaapPluginMyWidget');
    expect(result.errors).toHaveLength(0);
  });

  it('should fail for empty content', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(''),
    });

    const result = await testFrontendLoading('https://plugins.example.com/cdn/plugins/my-widget/1.0.0/my-widget.js');

    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.includes('empty'))).toBe(true);
  });

  it('should fail for HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    const result = await testFrontendLoading('https://plugins.example.com/cdn/plugins/my-widget/1.0.0/my-widget.js');

    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.includes('404'))).toBe(true);
  });

  it('should fail for non-UMD content', async () => {
    const regularJs = `
      function hello() {
        console.log("Hello world");
      }
    `;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(regularJs),
    });

    const result = await testFrontendLoading('https://plugins.example.com/cdn/plugins/my-widget/1.0.0/my-widget.js');

    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.includes('UMD'))).toBe(true);
  });

  it('should handle network errors', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    const result = await testFrontendLoading('https://plugins.example.com/cdn/plugins/my-widget/1.0.0/my-widget.js');

    expect(result.success).toBe(false);
    expect(result.errors).toContain('Network error');
  });

  it('should handle timeout', async () => {
    mockFetch.mockImplementationOnce(
      () => new Promise((_, reject) => {
        setTimeout(() => {
          const error = new Error('Timeout');
          error.name = 'AbortError';
          reject(error);
        }, 50);
      })
    );

    const result = await testFrontendLoading('https://plugins.example.com/cdn/plugins/my-widget/1.0.0/my-widget.js', 100);

    // AbortError should be caught
    expect(result.success).toBe(false);
  }, 10000);

  it('should warn when React is bundled in a large bundle', async () => {
    // Create a content string that's > 200KB and contains React patterns
    const largeContent = `
      typeof exports === 'object';
      exports.mount = function() {};
      NaapPlugin;
      react-dom createElement
    ` + 'x'.repeat(200 * 1024 + 1);

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(largeContent),
    });

    const result = await testFrontendLoading('https://plugins.example.com/cdn/plugins/my-widget/1.0.0/my-widget.js');

    expect(result.warnings.some(w => w.includes('React'))).toBe(true);
  });

  it('should pass for bundle with mount export', async () => {
    const bundleWithMount = `
      typeof exports === 'object';
      NaapPlugin;
      exports.mount = function(container, context) {
        // render logic
      };
    `;

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(bundleWithMount),
    });

    const result = await testFrontendLoading('https://plugins.example.com/cdn/plugins/my-widget/1.0.0/my-widget.js');

    expect(result.success).toBe(true);
    expect(result.bundleValid).toBe(true);
  });
});

describe('testBackendHealth', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockLookup.mockReset();
    mockLookup.mockImplementation(async () => [{ address: '93.184.216.34', family: 4 }] as any);
  });

  it('should pass for healthy backend', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ status: 'ok', version: '1.0.0' }),
    });

    const result = await testBackendHealth('https://api.example.com');

    expect(result.success).toBe(true);
    expect(result.healthy).toBe(true);
    expect(result.status).toBe('ok');
    expect(result.version).toBe('1.0.0');
  });

  it('should detect unhealthy backend', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ status: 'unhealthy', error: 'DB connection failed' }),
    });

    const result = await testBackendHealth('https://api.example.com');

    expect(result.success).toBe(true);
    expect(result.healthy).toBe(false);
    expect(result.status).toBe('unhealthy');
  });

  it('should fail for HTTP error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });

    const result = await testBackendHealth('https://api.example.com');

    expect(result.success).toBe(false);
    expect(result.healthy).toBe(false);
    expect(result.errors.some(e => e.includes('500'))).toBe(true);
  });

  it('should handle connection refused', async () => {
    const error = new Error('connect ECONNREFUSED 127.0.0.1:4001');
    mockFetch.mockRejectedValueOnce(error);

    const result = await testBackendHealth('https://api.example.com');

    expect(result.success).toBe(false);
    expect(result.healthy).toBe(false);
    expect(result.errors.some(e => e.includes('not running') || e.includes('ECONNREFUSED'))).toBe(true);
  });

  it('should accept healthy status string', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ status: 'healthy' }),
    });

    const result = await testBackendHealth('https://api.example.com');

    expect(result.healthy).toBe(true);
  });

  it('should handle non-JSON response gracefully', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.reject(new Error('Invalid JSON')),
    });

    const result = await testBackendHealth('https://api.example.com');

    // Should still pass if HTTP 200
    expect(result.success).toBe(true);
    expect(result.healthy).toBe(true);
  });
});

describe('testPlugin', () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockLookup.mockReset();
    mockLookup.mockImplementation(async () => [{ address: '93.184.216.34', family: 4 }] as any);
  });

  it('should test both frontend and backend', async () => {
    // Mock frontend response (UMD bundle)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(`
        typeof exports === 'object';
        global["NaapPluginTestPlugin"] = {};
        exports.mount = function(container, context) {};
        NaapPlugin;
      `),
    });

    // Mock backend response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ status: 'ok' }),
    });

    const result = await testPlugin({
      frontendUrl: 'https://plugins.example.com/cdn/plugins/test-plugin/1.0.0/test-plugin.js',
      backendUrl: 'https://api.example.com',
    });

    expect(result.success).toBe(true);
    expect(result.frontend?.success).toBe(true);
    expect(result.backend?.healthy).toBe(true);
    expect(result.overallErrors).toHaveLength(0);
  });

  it('should aggregate errors from both frontend and backend', async () => {
    // Mock frontend failure
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: 'Not Found',
    });

    // Mock backend failure
    mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    const result = await testPlugin({
      frontendUrl: 'https://plugins.example.com/cdn/plugins/test-plugin/1.0.0/test-plugin.js',
      backendUrl: 'https://api.example.com',
    });

    expect(result.success).toBe(false);
    expect(result.overallErrors.length).toBeGreaterThan(0);
    expect(result.overallErrors.some(e => e.includes('Frontend'))).toBe(true);
    expect(result.overallErrors.some(e => e.includes('Backend'))).toBe(true);
  });

  it('should pass with frontend only', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: () => Promise.resolve(`
        typeof exports === 'object';
        NaapPlugin;
        exports.mount = function(container, context) {};
      `),
    });

    const result = await testPlugin({
      frontendUrl: 'https://plugins.example.com/cdn/plugins/test-plugin/1.0.0/test-plugin.js',
    });

    expect(result.success).toBe(true);
    expect(result.frontend).toBeDefined();
    expect(result.backend).toBeUndefined();
  });

  it('should pass with backend only', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ status: 'ok' }),
    });

    const result = await testPlugin({
      backendUrl: 'https://api.example.com',
    });

    expect(result.success).toBe(true);
    expect(result.backend).toBeDefined();
    expect(result.frontend).toBeUndefined();
  });
});
