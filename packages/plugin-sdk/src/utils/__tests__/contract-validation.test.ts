/**
 * Contract Validation Tests
 *
 * Validates the runtime contract validation utility that catches
 * common plugin mistakes before they cause cryptic errors.
 */

import { describe, it, expect } from 'vitest';
import {
  validatePluginModule,
  validateShellContext,
  formatPluginError,
} from '../contract-validation';

describe('validatePluginModule', () => {
  it('passes for a valid module with mount function', () => {
    const module = { mount: (_c: HTMLElement, _ctx: unknown) => () => {} };
    const result = validatePluginModule(module, 'test-plugin');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('passes for a valid module with mount, unmount, and metadata', () => {
    const module = {
      mount: (_c: HTMLElement, _ctx: unknown) => () => {},
      unmount: () => {},
      metadata: { name: 'test-plugin', version: '1.0.0' },
    };
    const result = validatePluginModule(module, 'test-plugin');
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('fails for null module', () => {
    const result = validatePluginModule(null, 'test-plugin');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('null');
  });

  it('fails for undefined module', () => {
    const result = validatePluginModule(undefined, 'test-plugin');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('undefined');
  });

  it('fails when module is a function (factory not called)', () => {
    const result = validatePluginModule(() => {}, 'test-plugin');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('function, not an object');
  });

  it('fails when module is a primitive', () => {
    const result = validatePluginModule('string-value', 'test-plugin');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('string');
  });

  it('fails when mount is missing and suggests createPlugin()', () => {
    const result = validatePluginModule({}, 'my-plugin');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('mount() is missing');
    expect(result.errors[0]).toContain('createPlugin()');
    expect(result.errors[0]).toContain('my-plugin');
  });

  it('fails when mount is not a function', () => {
    const result = validatePluginModule({ mount: 'not-a-fn' }, 'test-plugin');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('mount is not a function');
    expect(result.errors[0]).toContain('got: string');
  });

  it('fails when unmount is not a function', () => {
    const module = {
      mount: (_c: HTMLElement) => () => {},
      unmount: 42,
    };
    const result = validatePluginModule(module, 'test-plugin');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('unmount is not a function');
  });

  it('warns when metadata is not an object', () => {
    const module = {
      mount: (_c: HTMLElement) => () => {},
      metadata: 'invalid',
    };
    const result = validatePluginModule(module, 'test-plugin');
    expect(result.valid).toBe(true); // warnings don't fail
    expect(result.warnings[0]).toContain('metadata is not an object');
  });

  it('warns when metadata.name is missing', () => {
    const module = {
      mount: (_c: HTMLElement) => () => {},
      metadata: { version: '1.0.0' },
    };
    const result = validatePluginModule(module, 'test-plugin');
    expect(result.valid).toBe(true);
    expect(result.warnings[0]).toContain('metadata.name');
  });

  it('warns when metadata.version is missing', () => {
    const module = {
      mount: (_c: HTMLElement) => () => {},
      metadata: { name: 'test' },
    };
    const result = validatePluginModule(module, 'test-plugin');
    expect(result.valid).toBe(true);
    expect(result.warnings[0]).toContain('metadata.version');
  });

  it('warns when metadata.name is empty string', () => {
    const module = {
      mount: (_c: HTMLElement) => () => {},
      metadata: { name: '', version: '1.0.0' },
    };
    const result = validatePluginModule(module, 'test-plugin');
    expect(result.warnings).toContainEqual(expect.stringContaining('metadata.name'));
  });
});

describe('validateShellContext', () => {
  it('passes for a valid context with navigate and eventBus', () => {
    const context = {
      auth: { user: {} },
      navigate: () => {},
      eventBus: { emit: () => {}, on: () => {} },
    };
    const result = validateShellContext(context);
    expect(result.valid).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('fails for null context', () => {
    const result = validateShellContext(null);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('null');
  });

  it('fails for undefined context', () => {
    const result = validateShellContext(undefined);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('undefined');
  });

  it('fails for non-object context', () => {
    const result = validateShellContext('bad');
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('string');
  });

  it('warns when navigate is missing', () => {
    const result = validateShellContext({ eventBus: {} });
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('navigate'))).toBe(true);
  });

  it('warns when eventBus is missing', () => {
    const result = validateShellContext({ navigate: () => {} });
    expect(result.valid).toBe(true);
    expect(result.warnings.some(w => w.includes('eventBus'))).toBe(true);
  });
});

describe('formatPluginError', () => {
  it('formats errors with plugin name and phase', () => {
    const result = {
      valid: false,
      errors: ['mount() is missing'],
      warnings: [],
    };
    const output = formatPluginError('my-plugin', 'load', result);
    expect(output).toContain('[NAAP Plugin Error]');
    expect(output).toContain('"my-plugin"');
    expect(output).toContain('load');
    expect(output).toContain('mount() is missing');
  });

  it('includes warnings in output', () => {
    const result = {
      valid: false,
      errors: [],
      warnings: ['metadata.name is missing'],
    };
    const output = formatPluginError('my-plugin', 'mount', result);
    expect(output).toContain('⚠');
    expect(output).toContain('metadata.name');
  });

  it('returns formatted message with errors and warnings', () => {
    const result = {
      valid: false,
      errors: ['error-1', 'error-2'],
      warnings: ['warn-1'],
    };
    const output = formatPluginError('test', 'load', result);
    expect(output).toContain('✗ error-1');
    expect(output).toContain('✗ error-2');
    expect(output).toContain('⚠ warn-1');
  });
});
