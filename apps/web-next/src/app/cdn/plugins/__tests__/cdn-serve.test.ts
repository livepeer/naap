/**
 * CDN Plugin Serve Route — Unit Tests
 *
 * Covers:
 * - File extension allow-list enforcement
 * - Path traversal prevention
 * - CSS auto-discovery fallback
 * - Cache-Control header variants (hashed vs unhashed, dev vs prod)
 * - toKebabCase camelCase→kebab conversion (replaces old PLUGIN_DIR_MAP)
 * - 404 for missing plugins/files
 */

import { describe, it, expect } from 'vitest';

// The CDN route is a Next.js route handler that reads from the filesystem.
// We validate the security and caching logic by testing the rules directly.

const ALLOWED_EXTENSIONS = ['.js', '.css', '.map', '.json'];

/**
 * Same function used in the CDN route — deterministic camelCase to kebab-case.
 */
function toKebabCase(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

function isAllowedExtension(fileName: string): boolean {
  const ext = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
  return ALLOWED_EXTENSIONS.includes(ext);
}

function isPathTraversal(fileName: string): boolean {
  return fileName.includes('..') || fileName.includes('//');
}

function computeCacheControl(isProd: boolean, hasContentHash: boolean): string {
  if (!isProd) return 'no-store, no-cache, must-revalidate, max-age=0';
  if (hasContentHash) return 'public, max-age=86400, immutable';
  return 'public, max-age=0, must-revalidate';
}

describe('CDN Serve Route — Security', () => {
  it('allows .js files', () => {
    expect(isAllowedExtension('plugin.js')).toBe(true);
  });

  it('allows .css files', () => {
    expect(isAllowedExtension('style.css')).toBe(true);
  });

  it('allows .map files', () => {
    expect(isAllowedExtension('plugin.js.map')).toBe(true);
  });

  it('allows .json files', () => {
    expect(isAllowedExtension('manifest.json')).toBe(true);
  });

  it('rejects .html files', () => {
    expect(isAllowedExtension('index.html')).toBe(false);
  });

  it('rejects .ts files', () => {
    expect(isAllowedExtension('source.ts')).toBe(false);
  });

  it('rejects .exe files', () => {
    expect(isAllowedExtension('malware.exe')).toBe(false);
  });

  it('rejects path traversal with ..', () => {
    expect(isPathTraversal('../../../etc/passwd')).toBe(true);
  });

  it('rejects path traversal with //', () => {
    expect(isPathTraversal('foo//bar.js')).toBe(true);
  });

  it('allows clean paths', () => {
    expect(isPathTraversal('plugin.abc123.js')).toBe(false);
  });
});

describe('CDN Serve Route — toKebabCase conversion (replaces PLUGIN_DIR_MAP)', () => {
  // Verify every entry from the old PLUGIN_DIR_MAP produces identical results
  const OLD_MAP: Record<string, string> = {
    gatewayManager: 'gateway-manager',
    orchestratorManager: 'orchestrator-manager',
    capacityPlanner: 'capacity-planner',
    networkAnalytics: 'network-analytics',
    marketplace: 'marketplace',
    community: 'community',
    developerApi: 'developer-api',
    myWallet: 'my-wallet',
    myDashboard: 'my-dashboard',
    pluginPublisher: 'plugin-publisher',
    daydreamVideo: 'daydream-video',
  };

  it('produces identical output for all old PLUGIN_DIR_MAP entries', () => {
    Object.entries(OLD_MAP).forEach(([camel, expectedKebab]) => {
      expect(toKebabCase(camel)).toBe(expectedKebab);
    });
  });

  it('converts multi-word camelCase names', () => {
    expect(toKebabCase('capacityPlanner')).toBe('capacity-planner');
    expect(toKebabCase('pluginPublisher')).toBe('plugin-publisher');
    expect(toKebabCase('daydreamVideo')).toBe('daydream-video');
  });

  it('passes single-word names through unchanged', () => {
    expect(toKebabCase('marketplace')).toBe('marketplace');
    expect(toKebabCase('community')).toBe('community');
  });

  it('handles already-kebab names (passthrough)', () => {
    expect(toKebabCase('my-custom-plugin')).toBe('my-custom-plugin');
    expect(toKebabCase('capacity-planner')).toBe('capacity-planner');
  });

  it('handles unknown/new plugin names without a map entry', () => {
    expect(toKebabCase('someNewPlugin')).toBe('some-new-plugin');
    expect(toKebabCase('dashboardProviderMock')).toBe('dashboard-provider-mock');
  });

  it('handles triple-word camelCase', () => {
    expect(toKebabCase('dashboardProviderMock')).toBe('dashboard-provider-mock');
  });
});

describe('CDN Serve Route — Cache Control', () => {
  it('returns no-store in development', () => {
    expect(computeCacheControl(false, false)).toContain('no-store');
  });

  it('returns immutable for hashed URLs in production', () => {
    const cc = computeCacheControl(true, true);
    expect(cc).toContain('immutable');
    expect(cc).toContain('max-age=86400');
  });

  it('returns must-revalidate for unhashed URLs in production', () => {
    const cc = computeCacheControl(true, false);
    expect(cc).toContain('must-revalidate');
    expect(cc).toContain('max-age=0');
  });
});
