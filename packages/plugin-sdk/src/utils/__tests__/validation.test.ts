/**
 * Plugin Manifest Validation — Unit Tests
 *
 * Covers:
 * - validateManifest: valid manifests, missing fields, invalid names, semver
 * - validatePluginName: kebab-case rules
 * - createDefaultManifest: template-specific defaults
 */

import { describe, it, expect } from 'vitest';
import { validateManifest, validatePluginName, createDefaultManifest } from '../validation.js';

describe('validateManifest', () => {
  const VALID = {
    name: 'my-plugin',
    displayName: 'My Plugin',
    version: '1.0.0',
    frontend: {
      entry: './dist/production/my-plugin.js',
      routes: ['/my-plugin'],
      navigation: { label: 'My Plugin', icon: 'Box', path: '/my-plugin' },
    },
  };

  it('accepts a valid frontend-only manifest', () => {
    const r = validateManifest(VALID);
    expect(r.valid).toBe(true);
    expect(r.errors).toHaveLength(0);
  });

  it('rejects null/undefined input', () => {
    const r = validateManifest(null);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });

  it('rejects manifest without name', () => {
    const r = validateManifest({ ...VALID, name: undefined });
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.path === 'name')).toBe(true);
  });

  it('rejects manifest with non-kebab name', () => {
    const r = validateManifest({ ...VALID, name: 'MyPlugin' });
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.message.includes('kebab-case'))).toBe(true);
  });

  it('rejects manifest without version', () => {
    const r = validateManifest({ ...VALID, version: undefined });
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.path === 'version')).toBe(true);
  });

  it('rejects manifest with invalid semver', () => {
    const r = validateManifest({ ...VALID, version: 'abc' });
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.message.includes('semver'))).toBe(true);
  });

  it('rejects manifest without displayName', () => {
    const r = validateManifest({ ...VALID, displayName: undefined });
    expect(r.valid).toBe(false);
    expect(r.errors.some(e => e.path === 'displayName')).toBe(true);
  });

  it('accepts pre-release semver versions', () => {
    const r = validateManifest({ ...VALID, version: '1.0.0-beta.1' });
    expect(r.valid).toBe(true);
  });

  it('accepts build metadata semver versions', () => {
    const r = validateManifest({ ...VALID, version: '1.0.0+build.123' });
    expect(r.valid).toBe(true);
  });
});

describe('validatePluginName', () => {
  it('accepts simple kebab-case', () => {
    expect(validatePluginName('my-plugin')).toBe(true);
  });

  it('accepts single-word lowercase', () => {
    expect(validatePluginName('plugin')).toBe(true);
  });

  it('rejects uppercase letters', () => {
    expect(validatePluginName('MyPlugin')).toBe(false);
  });

  it('rejects spaces', () => {
    expect(validatePluginName('my plugin')).toBe(false);
  });

  it('rejects names starting with a number', () => {
    expect(validatePluginName('1plugin')).toBe(false);
  });

  it('rejects names starting with a hyphen', () => {
    expect(validatePluginName('-plugin')).toBe(false);
  });

  it('rejects empty string', () => {
    expect(validatePluginName('')).toBe(false);
  });
});

describe('createDefaultManifest', () => {
  it('creates full-stack manifest with both frontend and backend', () => {
    const m = createDefaultManifest('my-plugin', 'full-stack', {
      displayName: 'My Plugin',
      description: 'Test',
      author: 'Test Author',
    });
    expect(m.name).toBe('my-plugin');
    expect(m.frontend).toBeDefined();
    expect(m.backend).toBeDefined();
  });

  it('creates frontend-only manifest without backend', () => {
    const m = createDefaultManifest('ui-widget', 'frontend-only', {
      displayName: 'UI Widget',
    });
    expect(m.frontend).toBeDefined();
    expect(m.backend).toBeUndefined();
  });

  it('creates backend-only manifest without frontend', () => {
    const m = createDefaultManifest('api-svc', 'backend-only', {
      displayName: 'API Service',
    });
    expect(m.frontend).toBeUndefined();
    expect(m.backend).toBeDefined();
  });

  it('uses provided displayName', () => {
    const m = createDefaultManifest('test', 'frontend-only', {
      displayName: 'Custom Display',
    });
    expect(m.displayName).toBe('Custom Display');
  });
});
