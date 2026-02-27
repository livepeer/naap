/**
 * Tests for remaining gaps closure:
 * - IP/CIDR validation and matching
 * - Circuit breaker
 * - Scope abstraction
 * - Auth presence validation
 */

import { describe, it, expect } from 'vitest';
import { matchIPAllowlist } from '../types';
import { parseScope, scopeId, isPersonalScope, personalScopeId, scopeFilter } from '../scope';

// ── IP/CIDR matching ──

describe('matchIPAllowlist', () => {
  it('matches exact IP', () => {
    expect(matchIPAllowlist('10.0.0.1', ['10.0.0.1'])).toBe(true);
  });

  it('rejects non-matching IP', () => {
    expect(matchIPAllowlist('10.0.0.2', ['10.0.0.1'])).toBe(false);
  });

  it('matches IP within CIDR range', () => {
    expect(matchIPAllowlist('192.168.1.50', ['192.168.1.0/24'])).toBe(true);
  });

  it('rejects IP outside CIDR range', () => {
    expect(matchIPAllowlist('192.168.2.1', ['192.168.1.0/24'])).toBe(false);
  });

  it('matches with /32 (single host)', () => {
    expect(matchIPAllowlist('10.0.0.5', ['10.0.0.5/32'])).toBe(true);
    expect(matchIPAllowlist('10.0.0.6', ['10.0.0.5/32'])).toBe(false);
  });

  it('matches with /0 (all addresses)', () => {
    expect(matchIPAllowlist('1.2.3.4', ['0.0.0.0/0'])).toBe(true);
  });

  it('supports mixed IPs and CIDRs in allowlist', () => {
    const list = ['10.0.0.1', '192.168.0.0/16'];
    expect(matchIPAllowlist('10.0.0.1', list)).toBe(true);
    expect(matchIPAllowlist('192.168.5.5', list)).toBe(true);
    expect(matchIPAllowlist('172.16.0.1', list)).toBe(false);
  });
});

// ── Scope abstraction ──

describe('Scope abstraction', () => {
  it('parseScope parses personal scope', () => {
    const scope = parseScope('personal:user-123');
    expect(scope).toEqual({ type: 'personal', userId: 'user-123' });
  });

  it('parseScope parses team scope', () => {
    const scope = parseScope('team-uuid-456');
    expect(scope).toEqual({ type: 'team', teamId: 'team-uuid-456' });
  });

  it('scopeId serializes personal scope', () => {
    expect(scopeId({ type: 'personal', userId: 'u1' })).toBe('personal:u1');
  });

  it('scopeId serializes team scope', () => {
    expect(scopeId({ type: 'team', teamId: 't1' })).toBe('t1');
  });

  it('isPersonalScope detects personal prefix', () => {
    expect(isPersonalScope('personal:u1')).toBe(true);
    expect(isPersonalScope('team-1')).toBe(false);
  });

  it('personalScopeId creates prefixed string', () => {
    expect(personalScopeId('user-123')).toBe('personal:user-123');
  });

  it('scopeFilter builds ownerUserId filter for personal scope', () => {
    const filter = scopeFilter('conn-1', 'personal:u1');
    expect(filter).toEqual({ id: 'conn-1', ownerUserId: 'u1' });
  });

  it('scopeFilter builds teamId filter for team scope', () => {
    const filter = scopeFilter('conn-1', 'team-1');
    expect(filter).toEqual({ id: 'conn-1', teamId: 'team-1' });
  });
});

// ── Auth presence validation ──

describe('Auth presence validation', () => {
  it('bearer sets warning header when secret is missing', async () => {
    const { bearerAuth } = await import('../transforms/auth/bearer');
    const headers = new Headers();
    bearerAuth.inject({
      headers,
      authConfig: { tokenRef: 'missing-secret' },
      secrets: {},
      connectorSlug: 'test-connector',
      method: 'GET',
      url: new URL('https://api.example.com'),
    });
    expect(headers.get('X-Gateway-Warning')).toBe('missing-auth-secret');
    expect(headers.has('Authorization')).toBe(false);
  });

  it('bearer sets auth header when secret is present', async () => {
    const { bearerAuth } = await import('../transforms/auth/bearer');
    const headers = new Headers();
    bearerAuth.inject({
      headers,
      authConfig: { tokenRef: 'token' },
      secrets: { token: 'my-secret' },
      connectorSlug: 'test-connector',
      method: 'GET',
      url: new URL('https://api.example.com'),
    });
    expect(headers.get('Authorization')).toBe('Bearer my-secret');
    expect(headers.has('X-Gateway-Warning')).toBe(false);
  });

  it('basic sets warning when both secrets are missing', async () => {
    const { basicAuth } = await import('../transforms/auth/basic');
    const headers = new Headers();
    basicAuth.inject({
      headers,
      authConfig: {},
      secrets: {},
      connectorSlug: 'test-connector',
      method: 'GET',
      url: new URL('https://api.example.com'),
    });
    expect(headers.get('X-Gateway-Warning')).toBe('missing-auth-secret');
  });

  it('query sets warning when secret is missing', async () => {
    const { queryAuth } = await import('../transforms/auth/query');
    const headers = new Headers();
    const url = new URL('https://api.example.com');
    queryAuth.inject({
      headers,
      authConfig: { paramName: 'key', secretRef: 'apiKey' },
      secrets: {},
      connectorSlug: 'test-connector',
      method: 'GET',
      url,
    });
    expect(headers.get('X-Gateway-Warning')).toBe('missing-auth-secret');
    expect(url.searchParams.has('key')).toBe(false);
  });
});
