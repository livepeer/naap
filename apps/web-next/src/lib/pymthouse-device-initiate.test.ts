import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  extractDeviceApprovalTupleFromTargetLink,
  tryParseDeviceApprovalCookie,
  encodeDeviceApprovalCookiePayload,
} from './pymthouse-device-initiate';

describe('pymthouse-device-initiate', () => {
  const prevBase = process.env.PMTHOUSE_BASE_URL;
  const prevIss = process.env.PYMTHOUSE_ISSUER_URL;
  const prevClient = process.env.PYMTHOUSE_PUBLIC_CLIENT_ID;

  beforeEach(() => {
    process.env.PMTHOUSE_BASE_URL = 'http://localhost:3001';
    process.env.PYMTHOUSE_ISSUER_URL = 'http://localhost:3001/api/v1/oidc';
    process.env.PYMTHOUSE_PUBLIC_CLIENT_ID = 'app_testpublic123';
  });

  afterEach(() => {
    process.env.PMTHOUSE_BASE_URL = prevBase;
    process.env.PYMTHOUSE_ISSUER_URL = prevIss;
    process.env.PYMTHOUSE_PUBLIC_CLIENT_ID = prevClient;
  });

  it('extractDeviceApprovalTupleFromTargetLink parses user_code and client_id', () => {
    const u = new URL('http://localhost:3001/oidc/device');
    u.searchParams.set('user_code', 'ABCD-EFGH');
    u.searchParams.set('client_id', 'app_testpublic123');
    u.searchParams.set('iss', 'http://localhost:3001/api/v1/oidc');
    const r = extractDeviceApprovalTupleFromTargetLink(u.href);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.userCode).toBe('ABCD-EFGH');
    expect(r.publicClientId).toBe('app_testpublic123');
  });

  it('extractDeviceApprovalTupleFromTargetLink uses issuer origin even when PMTHOUSE_BASE_URL is NaaP', () => {
    process.env.PMTHOUSE_BASE_URL = 'http://localhost:3000';
    process.env.PYMTHOUSE_ISSUER_URL = 'http://localhost:3001/api/v1/oidc';
    const u = new URL('http://localhost:3001/oidc/device');
    u.searchParams.set('user_code', 'ABCD-EFGH');
    u.searchParams.set('client_id', 'app_testpublic123');
    const r = extractDeviceApprovalTupleFromTargetLink(u.href);
    expect('error' in r).toBe(false);
    if ('error' in r) return;
    expect(r.userCode).toBe('ABCD-EFGH');
  });

  it('extractDeviceApprovalTupleFromTargetLink rejects client_id mismatch', () => {
    const u = new URL('http://localhost:3001/oidc/device');
    u.searchParams.set('user_code', 'ABCD-EFGH');
    u.searchParams.set('client_id', 'app_other');
    const r = extractDeviceApprovalTupleFromTargetLink(u.href);
    expect('error' in r).toBe(true);
  });

  it('tryParseDeviceApprovalCookie rejects expired payload', () => {
    const raw = JSON.stringify({
      userCode: 'ABCD-EFGH',
      publicClientId: 'app_x',
      exp: Date.now() - 1000,
    });
    expect(tryParseDeviceApprovalCookie(raw)).toBeNull();
  });

  it('encode + tryParse round-trips', () => {
    const raw = encodeDeviceApprovalCookiePayload({
      userCode: 'ZZZZ-YYYY',
      publicClientId: 'app_testpublic123',
    });
    const p = tryParseDeviceApprovalCookie(raw);
    expect(p).not.toBeNull();
    expect(p?.userCode).toBe('ZZZZ-YYYY');
    expect(p?.publicClientId).toBe('app_testpublic123');
  });
});
