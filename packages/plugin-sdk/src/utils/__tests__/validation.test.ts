/**
 * Plugin Manifest Validation — Unit Tests
 *
 * Covers:
 * - validateManifest: valid manifests, missing fields, invalid names, semver
 * - validatePluginName: kebab-case rules
 * - createDefaultManifest: template-specific defaults
 */

import { describe, it, expect } from 'vitest';
import { validateManifest, validatePluginName, validateVersion, createDefaultManifest } from '../validation.js';

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

describe('validateVersion', () => {
  it('accepts standard semver', () => {
    expect(validateVersion('1.0.0')).toBe(true);
  });

  it('accepts pre-release semver', () => {
    expect(validateVersion('2.1.0-alpha.1')).toBe(true);
  });

  it('rejects non-semver strings', () => {
    expect(validateVersion('not-a-version')).toBe(false);
    expect(validateVersion('1.0')).toBe(false);
    expect(validateVersion('')).toBe(false);
  });
});

// ------------------------------------------------------------------
// validateManifest — sub-validator branch paths
// ------------------------------------------------------------------
describe('validateManifest — frontend sub-validator', () => {
  const BASE = {
    name: 'my-plugin',
    displayName: 'My Plugin',
    version: '1.0.0',
  };

  it('rejects frontend that is not an object', () => {
    const r = validateManifest({ ...BASE, frontend: 'bad' });
    expect(r.errors.some(e => e.path === 'frontend')).toBe(true);
  });

  it('rejects missing frontend.entry', () => {
    const r = validateManifest({ ...BASE, frontend: { routes: ['/test'] } });
    expect(r.errors.some(e => e.path === 'frontend.entry')).toBe(true);
  });

  it('rejects empty frontend.routes array', () => {
    const r = validateManifest({ ...BASE, frontend: { entry: './dist/x.js', routes: [] } });
    expect(r.errors.some(e => e.path === 'frontend.routes')).toBe(true);
  });

  it('rejects route not starting with /', () => {
    const r = validateManifest({ ...BASE, frontend: { entry: './dist/x.js', routes: ['no-slash'] } });
    expect(r.errors.some(e => e.path.startsWith('frontend.routes'))).toBe(true);
  });

  it('warns when navigation is missing', () => {
    const r = validateManifest({ ...BASE, frontend: { entry: './dist/x.js', routes: ['/x'] } });
    expect(r.warnings.some(w => w.path === 'frontend.navigation')).toBe(true);
  });

  it('rejects navigation without label', () => {
    const r = validateManifest({ ...BASE, frontend: { entry: './dist/x.js', routes: ['/x'], navigation: { icon: 'Box', path: '/x' } } });
    expect(r.errors.some(e => e.path === 'frontend.navigation.label')).toBe(true);
  });

  it('warns when navigation.icon is missing', () => {
    const r = validateManifest({ ...BASE, frontend: { entry: './dist/x.js', routes: ['/x'], navigation: { label: 'X', path: '/x' } } });
    expect(r.warnings.some(w => w.path === 'frontend.navigation.icon')).toBe(true);
  });
});

describe('validateManifest — backend sub-validator', () => {
  const BASE = {
    name: 'my-plugin',
    displayName: 'My Plugin',
    version: '1.0.0',
  };

  it('rejects backend that is not an object', () => {
    const r = validateManifest({ ...BASE, backend: 42 });
    expect(r.errors.some(e => e.path === 'backend')).toBe(true);
  });

  it('rejects missing backend.entry', () => {
    const r = validateManifest({ ...BASE, backend: { port: 4500, apiPrefix: '/api/v1/x' } });
    expect(r.errors.some(e => e.path === 'backend.entry')).toBe(true);
  });

  it('rejects backend.port below 1024', () => {
    const r = validateManifest({ ...BASE, backend: { entry: './dist/s.js', port: 80, apiPrefix: '/api/v1/x' } });
    expect(r.errors.some(e => e.path === 'backend.port')).toBe(true);
  });

  it('rejects backend.port above 65535', () => {
    const r = validateManifest({ ...BASE, backend: { entry: './dist/s.js', port: 70000, apiPrefix: '/api/v1/x' } });
    expect(r.errors.some(e => e.path === 'backend.port')).toBe(true);
  });

  it('rejects missing backend.apiPrefix', () => {
    const r = validateManifest({ ...BASE, backend: { entry: './dist/s.js', port: 4500 } });
    expect(r.errors.some(e => e.path === 'backend.apiPrefix')).toBe(true);
  });

  it('warns when apiPrefix does not start with /api/', () => {
    const r = validateManifest({ ...BASE, backend: { entry: './dist/s.js', port: 4500, apiPrefix: '/x/custom' } });
    expect(r.warnings.some(w => w.path === 'backend.apiPrefix')).toBe(true);
  });

  it('warns when healthCheck is missing', () => {
    const r = validateManifest({ ...BASE, backend: { entry: './dist/s.js', port: 4500, apiPrefix: '/api/v1/x' } });
    expect(r.warnings.some(w => w.path === 'backend.healthCheck')).toBe(true);
  });
});

describe('validateManifest — database sub-validator', () => {
  const BASE = {
    name: 'my-plugin',
    displayName: 'My Plugin',
    version: '1.0.0',
    backend: { entry: './dist/s.js', port: 4500, apiPrefix: '/api/v1/x' },
  };

  it('rejects database that is not an object', () => {
    const r = validateManifest({ ...BASE, database: 'pg' });
    expect(r.errors.some(e => e.path === 'database')).toBe(true);
  });

  it('rejects invalid database.type', () => {
    const r = validateManifest({ ...BASE, database: { type: 'redis' } });
    expect(r.errors.some(e => e.path === 'database.type')).toBe(true);
  });

  it('rejects postgresql without schema', () => {
    const r = validateManifest({ ...BASE, database: { type: 'postgresql' } });
    expect(r.errors.some(e => e.path === 'database.schema')).toBe(true);
  });

  it('rejects mysql without schema', () => {
    const r = validateManifest({ ...BASE, database: { type: 'mysql' } });
    expect(r.errors.some(e => e.path === 'database.schema')).toBe(true);
  });

  it('accepts mongodb without schema requirement', () => {
    const r = validateManifest({ ...BASE, database: { type: 'mongodb' } });
    expect(r.errors.some(e => e.path === 'database.schema')).toBe(false);
  });
});

describe('validateManifest — optional field warnings', () => {
  const MINIMAL = {
    name: 'my-plugin',
    displayName: 'My Plugin',
    version: '1.0.0',
    frontend: { entry: './dist/x.js', routes: ['/x'] },
  };

  it('warns when description is missing', () => {
    const r = validateManifest(MINIMAL);
    expect(r.warnings.some(w => w.path === 'description')).toBe(true);
  });

  it('warns when author is missing', () => {
    const r = validateManifest(MINIMAL);
    expect(r.warnings.some(w => w.path === 'author')).toBe(true);
  });

  it('warns when license is missing', () => {
    const r = validateManifest(MINIMAL);
    expect(r.warnings.some(w => w.path === 'license')).toBe(true);
  });

  it('errors when neither frontend nor backend defined', () => {
    const r = validateManifest({ name: 'my-plugin', displayName: 'x', version: '1.0.0' });
    expect(r.errors.some(e => e.message.includes('at least a frontend or backend'))).toBe(true);
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
