import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  extractDeviceApprovalTupleFromTargetLink,
  getExpectedPymthouseIssuer,
  tryParseDeviceApprovalCookie,
  encodeDeviceApprovalCookiePayload,
  validatePymthouseDeviceInitiateQuery,
} from './pymthouse-device-initiate';

describe('pymthouse-device-initiate', () => {
  const prevBase = process.env.PMTHOUSE_BASE_URL;
  const prevIss = process.env.PYMTHOUSE_ISSUER_URL;
  const prevClient = process.env.PYMTHOUSE_PUBLIC_CLIENT_ID;
  const prevCookieSecret = process.env.PYMTHOUSE_DEVICE_COOKIE_SECRET;

  beforeEach(() => {
    process.env.PMTHOUSE_BASE_URL = 'http://localhost:3001';
    process.env.PYMTHOUSE_ISSUER_URL = 'http://localhost:3001/api/v1/oidc';
    process.env.PYMTHOUSE_PUBLIC_CLIENT_ID = 'app_testpublic123';
    process.env.PYMTHOUSE_DEVICE_COOKIE_SECRET = 'test-pymthouse-cookie-secret';
  });

  afterEach(() => {
    process.env.PMTHOUSE_BASE_URL = prevBase;
    process.env.PYMTHOUSE_ISSUER_URL = prevIss;
    process.env.PYMTHOUSE_PUBLIC_CLIENT_ID = prevClient;
    process.env.PYMTHOUSE_DEVICE_COOKIE_SECRET = prevCookieSecret;
  });

  it('getExpectedPymthouseIssuer returns null for malformed issuer URL', () => {
    process.env.PYMTHOUSE_ISSUER_URL = 'not a valid url:%%%';
    expect(getExpectedPymthouseIssuer()).toBeNull();
  });

  it('validatePymthouseDeviceInitiateQuery fails when issuer env is malformed', () => {
    process.env.PYMTHOUSE_ISSUER_URL = 'not a valid url:%%%';
    const target = new URL('http://localhost:3001/oidc/device');
    target.searchParams.set('user_code', 'ABCD-EFGH');
    target.searchParams.set('client_id', 'app_testpublic123');
    const r = validatePymthouseDeviceInitiateQuery(
      'http://localhost:3001/api/v1/oidc',
      target.href,
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('server_not_configured');
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

  it('tryParseDeviceApprovalCookie rejects expired payload', async () => {
    const raw = JSON.stringify({
      userCode: 'ABCD-EFGH',
      publicClientId: 'app_x',
      exp: Date.now() - 1000,
    });
    await expect(tryParseDeviceApprovalCookie(raw)).resolves.toBeNull();
  });

  it('encode + tryParse round-trips', async () => {
    const raw = await encodeDeviceApprovalCookiePayload({
      userCode: 'ZZZZ-YYYY',
      publicClientId: 'app_testpublic123',
    });
    const p = await tryParseDeviceApprovalCookie(raw);
    expect(p).not.toBeNull();
    expect(p?.userCode).toBe('ZZZZ-YYYY');
    expect(p?.publicClientId).toBe('app_testpublic123');
  });
});
