/**
 * Phase 1 Verification Tests
 *
 * Tests for dependency resolution, version constraint checking,
 * and dev plugin override detection.
 */

import { describe, it, expect } from 'vitest';
import {
  sortPluginsByDependency,
  checkDependencies,
  extractPluginsWithVersions,
  findAffectedByOverride,
} from '../transformers';
import type { RuntimePluginManifest } from '../plugin';

// Helper to create minimal plugin manifests for testing
function createPlugin(
  name: string,
  options: {
    order?: number;
    version?: string;
    dependencies?: Array<{ name: string; version: string; optional?: boolean }>;
  } = {}
): RuntimePluginManifest {
  return {
    id: `test-${name}`,
    name,
    displayName: name.charAt(0).toUpperCase() + name.slice(1),
    version: options.version || '1.0.0',
    remoteUrl: `http://localhost:3000/cdn/plugins/${name}/1.0.0/${name}.js`,
    routes: [`/${name}`],
    enabled: true,
    order: options.order ?? 0,
    dependencies: options.dependencies
      ? { plugins: options.dependencies }
      : undefined,
  };
}

describe('Phase 1: Dependency Resolution', () => {
  describe('sortPluginsByDependency', () => {
    it('should load dependencies before dependents regardless of order (Issue #38)', () => {
      const plugins = [
        createPlugin('child', {
          order: 1,
          dependencies: [{ name: 'parent', version: '*' }],
        }),
        createPlugin('parent', { order: 2 }),
      ];

      // Sort by order first (as fixed in Issue #38)
      plugins.sort((a, b) => a.order - b.order);

      // Then resolve dependencies
      const sorted = sortPluginsByDependency(plugins);

      expect(sorted[0].name).toBe('parent');
      expect(sorted[1].name).toBe('child');
    });

    it('should handle multiple levels of dependencies', () => {
      const plugins = [
        createPlugin('grandchild', {
          order: 1,
          dependencies: [{ name: 'child', version: '*' }],
        }),
        createPlugin('child', {
          order: 2,
          dependencies: [{ name: 'parent', version: '*' }],
        }),
        createPlugin('parent', { order: 3 }),
      ];

      plugins.sort((a, b) => a.order - b.order);
      const sorted = sortPluginsByDependency(plugins);

      expect(sorted[0].name).toBe('parent');
      expect(sorted[1].name).toBe('child');
      expect(sorted[2].name).toBe('grandchild');
    });

    it('should handle circular dependencies gracefully', () => {
      const plugins = [
        createPlugin('a', { dependencies: [{ name: 'b', version: '*' }] }),
        createPlugin('b', { dependencies: [{ name: 'a', version: '*' }] }),
      ];

      // Should not throw, just log warning
      const sorted = sortPluginsByDependency(plugins);
      expect(sorted.length).toBe(2);
    });

    it('should handle missing dependencies', () => {
      const plugins = [
        createPlugin('child', {
          dependencies: [{ name: 'missing', version: '*' }],
        }),
      ];

      const sorted = sortPluginsByDependency(plugins);
      expect(sorted.length).toBe(1);
      expect(sorted[0].name).toBe('child');
    });
  });

  describe('checkDependencies - Version Constraints (Issue #33)', () => {
    it('should detect version mismatch with caret constraint', () => {
      const plugin = createPlugin('child', {
        dependencies: [{ name: 'parent', version: '^2.0.0' }],
      });

      const available = new Map([['parent', { version: '1.5.0' }]]);
      const result = checkDependencies(plugin, available);

      expect(result.missing).toHaveLength(0);
      expect(result.versionMismatch).toHaveLength(1);
      expect(result.versionMismatch[0]).toEqual({
        name: 'parent',
        required: '^2.0.0',
        available: '1.5.0',
      });
    });

    it('should accept compatible caret versions', () => {
      const plugin = createPlugin('child', {
        dependencies: [{ name: 'parent', version: '^1.0.0' }],
      });

      const available = new Map([['parent', { version: '1.5.0' }]]);
      const result = checkDependencies(plugin, available);

      expect(result.missing).toHaveLength(0);
      expect(result.versionMismatch).toHaveLength(0);
    });

    it('should handle tilde version constraint', () => {
      const plugin = createPlugin('child', {
        dependencies: [{ name: 'parent', version: '~1.0.0' }],
      });

      // Should fail - different minor version
      const available1 = new Map([['parent', { version: '1.1.0' }]]);
      const result1 = checkDependencies(plugin, available1);
      expect(result1.versionMismatch).toHaveLength(1);

      // Should pass - same minor, higher patch
      const available2 = new Map([['parent', { version: '1.0.5' }]]);
      const result2 = checkDependencies(plugin, available2);
      expect(result2.versionMismatch).toHaveLength(0);
    });

    it('should handle >= version constraint', () => {
      const plugin = createPlugin('child', {
        dependencies: [{ name: 'parent', version: '>=1.5.0' }],
      });

      // Should fail - lower version
      const available1 = new Map([['parent', { version: '1.4.0' }]]);
      const result1 = checkDependencies(plugin, available1);
      expect(result1.versionMismatch).toHaveLength(1);

      // Should pass - equal version
      const available2 = new Map([['parent', { version: '1.5.0' }]]);
      const result2 = checkDependencies(plugin, available2);
      expect(result2.versionMismatch).toHaveLength(0);

      // Should pass - higher version
      const available3 = new Map([['parent', { version: '2.0.0' }]]);
      const result3 = checkDependencies(plugin, available3);
      expect(result3.versionMismatch).toHaveLength(0);
    });

    it('should accept wildcard version', () => {
      const plugin = createPlugin('child', {
        dependencies: [{ name: 'parent', version: '*' }],
      });

      const available = new Map([['parent', { version: '0.0.1' }]]);
      const result = checkDependencies(plugin, available);

      expect(result.missing).toHaveLength(0);
      expect(result.versionMismatch).toHaveLength(0);
    });

    it('should report missing non-optional dependencies', () => {
      const plugin = createPlugin('child', {
        dependencies: [{ name: 'missing', version: '^1.0.0' }],
      });

      const available = new Map<string, { version: string }>();
      const result = checkDependencies(plugin, available);

      expect(result.missing).toEqual(['missing']);
      expect(result.versionMismatch).toHaveLength(0);
    });

    it('should not report missing optional dependencies', () => {
      const plugin = createPlugin('child', {
        dependencies: [{ name: 'optional', version: '^1.0.0', optional: true }],
      });

      const available = new Map<string, { version: string }>();
      const result = checkDependencies(plugin, available);

      expect(result.missing).toHaveLength(0);
      expect(result.versionMismatch).toHaveLength(0);
    });
  });

  describe('findAffectedByOverride - Dev Plugin Override (Issue #9)', () => {
    it('should find plugins that depend on overridden dev plugins', () => {
      const devPluginNames = new Set(['core-api']);

      const productionPlugins = [
        createPlugin('core-api'),
        createPlugin('dashboard', {
          dependencies: [{ name: 'core-api', version: '*' }],
        }),
        createPlugin('settings', {
          dependencies: [{ name: 'core-api', version: '*' }],
        }),
        createPlugin('standalone'), // No dependencies
      ];

      const affected = findAffectedByOverride(devPluginNames, productionPlugins);

      expect(affected.length).toBe(2);
      expect(affected.map(p => p.name)).toContain('dashboard');
      expect(affected.map(p => p.name)).toContain('settings');
      expect(affected.map(p => p.name)).not.toContain('standalone');
    });

    it('should return empty array when no plugins are affected', () => {
      const devPluginNames = new Set(['unrelated-plugin']);

      const productionPlugins = [
        createPlugin('dashboard', {
          dependencies: [{ name: 'core-api', version: '*' }],
        }),
      ];

      const affected = findAffectedByOverride(devPluginNames, productionPlugins);
      expect(affected).toHaveLength(0);
    });

    it('should handle plugins without dependencies', () => {
      const devPluginNames = new Set(['some-plugin']);

      const productionPlugins = [
        createPlugin('standalone1'),
        createPlugin('standalone2'),
      ];

      const affected = findAffectedByOverride(devPluginNames, productionPlugins);
      expect(affected).toHaveLength(0);
    });
  });

  describe('extractPluginsWithVersions', () => {
    it('should create a map of plugin names to versions', () => {
      const plugins = [
        createPlugin('a', { version: '1.0.0' }),
        createPlugin('b', { version: '2.5.0' }),
        createPlugin('c', { version: '0.1.0' }),
      ];

      const map = extractPluginsWithVersions(plugins);

      expect(map.size).toBe(3);
      expect(map.get('a')).toEqual({ version: '1.0.0' });
      expect(map.get('b')).toEqual({ version: '2.5.0' });
      expect(map.get('c')).toEqual({ version: '0.1.0' });
    });
  });
});
