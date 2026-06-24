/** @vitest-environment node */

import { describe, it, expect } from 'vitest';

import {
  INVALID_APP_ID,
  buildFrontDoorResponse,
  extractAppId,
  isNativeKeyToken,
  parseBearer,
} from './validate-key';

describe('parseBearer', () => {
  it('extracts the token', () => {
    expect(parseBearer('Bearer naap_abc')).toBe('naap_abc');
    expect(parseBearer('bearer  naap_abc ')).toBe('naap_abc');
  });
  it('returns null for missing/non-bearer', () => {
    expect(parseBearer(null)).toBeNull();
    expect(parseBearer('Basic xyz')).toBeNull();
  });
});

describe('isNativeKeyToken (D1: native only)', () => {
  it('accepts naap_ and rejects provider tokens', () => {
    expect(isNativeKeyToken('naap_abc')).toBe(true);
    expect(isNativeKeyToken('pmth_abc')).toBe(false);
  });
});

describe('extractAppId', () => {
  it('returns null when absent/empty', () => {
    expect(extractAppId(null)).toBeNull();
    expect(extractAppId('   ')).toBeNull();
  });
  it('accepts a valid slug/uuid', () => {
    expect(extractAppId('storyboard')).toBe('storyboard');
    expect(extractAppId('app_123-abc.def')).toBe('app_123-abc.def');
  });
  it('flags malformed ids (never used to build a URL/query)', () => {
    expect(extractAppId('bad id!')).toBe(INVALID_APP_ID);
    expect(extractAppId('x'.repeat(200))).toBe(INVALID_APP_ID);
  });
});

describe('buildFrontDoorResponse (BPP ③ shape)', () => {
  const base = {
    userSub: 'user-1',
    billingAccountRef: { providerSlug: 'pymthouse', accountId: 'acct_om_1' },
    signerSession: { accessToken: 'tok', tokenType: 'Bearer', expiresIn: 3600 },
  };

  it('produces the contract shape with capabilities defaulting to []', () => {
    const res = buildFrontDoorResponse(base);
    expect(res).toMatchObject({
      valid: true,
      user: { sub: 'user-1' },
      billingAccount: { id: 'acct_om_1', providerSlug: 'pymthouse' },
      capabilities: [],
      quota: null,
    });
    expect(res.signerSession.accessToken).toBe('tok');
    expect(res.app).toBeUndefined();
  });

  it('includes app attribution only when an appId is given', () => {
    const res = buildFrontDoorResponse({ ...base, appId: 'storyboard', capabilities: ['text-to-image:sdxl'] });
    expect(res.app).toEqual({ id: 'storyboard' });
    expect(res.capabilities).toEqual(['text-to-image:sdxl']);
  });

  it('passes through quota when provided', () => {
    const res = buildFrontDoorResponse({ ...base, quota: { remaining: 10, resetAt: '2026-12-31T00:00:00Z' } });
    expect(res.quota).toEqual({ remaining: 10, resetAt: '2026-12-31T00:00:00Z' });
  });

  it('INV (P4): omits the discovery field by default (byte-for-byte today)', () => {
    expect(buildFrontDoorResponse(base).discovery).toBeUndefined();
    expect(buildFrontDoorResponse({ ...base, discovery: null }).discovery).toBeUndefined();
  });

  it('P4: includes the per-app discovery field only when resolved', () => {
    const res = buildFrontDoorResponse({
      ...base,
      discovery: { planId: 'dp_1', url: '/api/v1/orchestrator-leaderboard/plans/dp_1/python-gateway' },
    });
    expect(res.discovery).toEqual({
      planId: 'dp_1',
      url: '/api/v1/orchestrator-leaderboard/plans/dp_1/python-gateway',
    });
  });
});
