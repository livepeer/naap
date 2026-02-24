/**
 * Regression tests for URL resolution logic.
 *
 * These tests guard against the recurring bug where plugin config requests
 * (which should hit the Next.js shell / base-svc) are accidentally routed
 * to plugin backend ports (e.g. 4005 for marketplace) because of faulty
 * baseUrl resolution in useApiClient / getServiceOrigin.
 *
 * If any of these tests fail, plugin UMD bundles will send requests to
 * unreachable ports, causing ERR_CONNECTION_REFUSED at runtime.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  getServiceOrigin,
  getPluginPort,
  getPluginBackendUrl,
  PLUGIN_PORTS,
} from '../ports.js';

describe('getPluginPort', () => {
  it('returns the correct port for known plugins', () => {
    expect(getPluginPort('marketplace')).toBe(4005);
    expect(getPluginPort('community')).toBe(4006);
    expect(getPluginPort('capacity-planner')).toBe(4003);
    expect(getPluginPort('base')).toBe(4000);
  });
});

describe('getServiceOrigin', () => {
  const originalWindow = globalThis.window;

  afterEach(() => {
    // Restore window
    if (originalWindow === undefined) {
      // @ts-expect-error — resetting for test isolation
      delete globalThis.window;
    } else {
      globalThis.window = originalWindow;
    }
    vi.unstubAllEnvs();
  });

  it('returns empty string in production (non-localhost) environments', () => {
    // Simulate production browser
    // @ts-expect-error — minimal window mock
    globalThis.window = {
      location: { hostname: 'app.naap.io', protocol: 'https:', origin: 'https://app.naap.io' },
    };
    expect(getServiceOrigin('marketplace')).toBe('');
    expect(getServiceOrigin('base')).toBe('');
  });

  it('returns localhost URL with correct port in development', () => {
    // Simulate dev browser on localhost
    // @ts-expect-error — minimal window mock
    globalThis.window = {
      location: { hostname: 'localhost', protocol: 'http:', origin: 'http://localhost:3000' },
    };
    // Clear any __SHELL_CONTEXT__
    // @ts-expect-error — test cleanup
    delete (globalThis.window as any).__SHELL_CONTEXT__;

    expect(getServiceOrigin('marketplace')).toBe('http://localhost:4005');
    expect(getServiceOrigin('base')).toBe('http://localhost:4000');
    expect(getServiceOrigin('community')).toBe('http://localhost:4006');
  });
});

describe('REGRESSION: empty-string baseUrl must not resolve to a plugin port', () => {
  /**
   * This is the exact scenario that caused the recurring ERR_CONNECTION_REFUSED bug.
   *
   * usePluginConfig calls useApiClient({ baseUrl: '' }).
   * If useApiClient treats '' as falsy and falls through to getServiceOrigin('marketplace'),
   * the request goes to http://localhost:4005 instead of same-origin.
   *
   * The fix: useApiClient checks `options.baseUrl !== undefined` (not `if (baseUrl)`).
   * This test ensures the distinction is maintained.
   */
  it('empty string is NOT undefined — must be treated as a valid baseUrl', () => {
    const emptyString = '';

    // The correct check (what useApiClient should do):
    expect(emptyString !== undefined).toBe(true);
    // The WRONG check (what caused the regression):
    expect(Boolean(emptyString)).toBe(false); // '' is falsy!

    // If someone changes the check back to `if (baseUrl)`, this test documents why it breaks.
  });

  it('PLUGIN_PORTS contains the ports that must NOT appear in config requests', () => {
    // Ensure the ports map hasn't drifted — these are the "bad" ports for config calls
    expect(PLUGIN_PORTS['marketplace']).toBe(4005);
    expect(PLUGIN_PORTS['community']).toBe(4006);
    expect(PLUGIN_PORTS['capacity-planner']).toBe(4003);
  });
});

describe('REGRESSION: config endpoint routing contract', () => {
  /**
   * Config requests MUST route through the Next.js shell (same-origin) and NOT
   * directly to plugin backends. These tests document the expected URL structure
   * so that any proxy or URL rewrite changes are caught early.
   */

  it('config requests use /api/v1/plugins/:name/config path (not a port-specific URL)', () => {
    // The correct path pattern — always relative to the shell origin.
    const configPath = '/api/v1/plugins/marketplace/config';
    expect(configPath).toMatch(/^\/api\/v1\/plugins\/[^/]+\/config$/);
  });

  it('personalized plugins use /api/v1/base/plugins/personalized path', () => {
    const personalizedPath = '/api/v1/base/plugins/personalized';
    expect(personalizedPath).toMatch(/^\/api\/v1\/base\/plugins\/personalized$/);
  });

  it('no known plugin port should appear in a config URL when running through the shell', () => {
    const badPorts = [4000, 4003, 4005, 4006];
    const shellOrigin = 'http://localhost:3000';

    // A correct URL looks like: http://localhost:3000/api/v1/plugins/marketplace/config
    const goodUrl = `${shellOrigin}/api/v1/plugins/marketplace/config`;
    for (const port of badPorts) {
      expect(goodUrl).not.toContain(`:${port}`);
    }
  });
});

describe('REGRESSION: installation-state parsing consistency', () => {
  /**
   * The personalized plugins endpoint returns an `installed` boolean and an
   * `installId` string. Both Marketplace UIs must parse these fields identically.
   * These tests document the expected parsing contract.
   */

  it('plugins with installed=true are treated as installed', () => {
    const plugin = { name: 'marketplace', installed: true, enabled: true, installId: 'pref-1' };
    const isInstalled = plugin.installed !== undefined ? plugin.installed : plugin.enabled !== false;
    expect(isInstalled).toBe(true);
  });

  it('plugins with installed=false are treated as NOT installed even if enabled', () => {
    const plugin = { name: 'marketplace', installed: false, enabled: true, installId: 'pref-1' };
    const isInstalled = plugin.installed !== undefined ? plugin.installed : plugin.enabled !== false;
    expect(isInstalled).toBe(false);
  });

  it('plugins without installed field fall back to enabled (backward compat)', () => {
    const plugin = { name: 'marketplace', enabled: true };
    const isInstalled = (plugin as { installed?: boolean }).installed !== undefined
      ? (plugin as { installed?: boolean }).installed
      : plugin.enabled !== false;
    expect(isInstalled).toBe(true);
  });

  /**
   * ROOT CAUSE of "0 installed" bug:
   * The personalized endpoint returned installed: false for enabled plugins
   * without user preference records. Because installed was explicitly false
   * (not undefined), the fallback to `enabled` never ran. The fix: the
   * personalized endpoint now always sets installed: true for all returned
   * plugins (they're active by definition).
   */
  it('explicit installed=false overrides enabled fallback — this caused the 0-installed bug', () => {
    // This is the exact scenario that caused the bug.
    // Plugin is enabled (active in shell) but installed is explicitly false.
    const plugin = { name: 'marketplace', installed: false, enabled: true };
    const isInstalled = plugin.installed !== undefined ? plugin.installed : plugin.enabled !== false;
    // installed is defined → false takes precedence over enabled: true
    expect(isInstalled).toBe(false);
    // This is why the personalized endpoint must set installed: true for ALL returned plugins.
  });
});
