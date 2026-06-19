/**
 * Guardrail tests for the application registry logic (NAAP-D).
 *
 * Proves the catalog DoD: "two registered apps get distinct attribution + scope
 * enforcement" — provider/app-agnostic, no app hardcoded.
 */

import { describe, it, expect } from 'vitest';
import {
  appAllowsCapability,
  appAllowsScope,
  invalidScopes,
  resolveAppAttribution,
  type RegisteredApp,
} from './registry';

function app(overrides: Partial<RegisteredApp> = {}): RegisteredApp {
  return {
    id: 'app-1',
    slug: 'app-one',
    type: 'app',
    teamId: 'team-1',
    ownerUserId: null,
    allowedScopes: [],
    allowedCapabilities: [],
    status: 'active',
    ...overrides,
  };
}

describe('resolveAppAttribution', () => {
  it('attributes two apps distinctly even within the same team', () => {
    const storyboard = app({ id: 'app-sb', slug: 'storyboard', teamId: 'team-1' });
    const cli = app({ id: 'app-cli', slug: 'naap-cli', teamId: 'team-1' });

    const a = resolveAppAttribution(storyboard);
    const b = resolveAppAttribution(cli);

    expect(a).toEqual({ appId: 'app-sb', slug: 'storyboard', ownerScope: 'team-1' });
    expect(b).toEqual({ appId: 'app-cli', slug: 'naap-cli', ownerScope: 'team-1' });
    expect(a.appId).not.toBe(b.appId);
  });

  it('uses personal:{userId} as the owner scope for personal apps', () => {
    const personal = app({ teamId: null, ownerUserId: 'user-9' });
    expect(resolveAppAttribution(personal).ownerScope).toBe('personal:user-9');
  });
});

describe('appAllowsScope', () => {
  it('enforces distinct coarse scopes per app', () => {
    const discoveryApp = app({ id: 'a', allowedScopes: ['discovery'] });
    const gatewayApp = app({ id: 'b', allowedScopes: ['gateway'] });

    expect(appAllowsScope(discoveryApp, 'discovery')).toBe(true);
    expect(appAllowsScope(discoveryApp, 'gateway')).toBe(false);

    expect(appAllowsScope(gatewayApp, 'gateway')).toBe(true);
    expect(appAllowsScope(gatewayApp, 'discovery')).toBe(false);
  });

  it('denies all scopes for a disabled app', () => {
    const disabled = app({ allowedScopes: ['discovery'], status: 'disabled' });
    expect(appAllowsScope(disabled, 'discovery')).toBe(false);
  });
});

describe('appAllowsCapability', () => {
  it('enforces capability grants and supports the wildcard', () => {
    const limited = app({ allowedCapabilities: ['text-to-image:sdxl'] });
    expect(appAllowsCapability(limited, 'text-to-image:sdxl')).toBe(true);
    expect(appAllowsCapability(limited, 'text-to-video:ltx')).toBe(false);

    const wildcard = app({ allowedCapabilities: ['*'] });
    expect(appAllowsCapability(wildcard, 'anything:goes')).toBe(true);
  });

  it('denies capabilities for a disabled app even with wildcard', () => {
    const disabled = app({ allowedCapabilities: ['*'], status: 'disabled' });
    expect(appAllowsCapability(disabled, 'x:y')).toBe(false);
  });
});

describe('invalidScopes', () => {
  it('flags unknown scopes and accepts known ones', () => {
    expect(invalidScopes(['discovery', 'gateway'])).toEqual([]);
    expect(invalidScopes(['discovery', 'bogus'])).toEqual(['bogus']);
  });
});
