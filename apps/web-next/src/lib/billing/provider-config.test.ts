/** @vitest-environment node */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import { BILLING_PROVIDERS } from '../../../../../packages/database/src/billing-providers';
import {
  PYMTHOUSE_PROVIDER_SLUG,
  PYMTHOUSE_STAGING_ISSUER_ORIGIN,
  PYMTHOUSE_STAGING_CLIENT_ID,
  PYMTHOUSE_ENV_VARS,
  verifyPymthouseEnv,
  logPymthouseEnvStatus,
  findPymthouseSeed,
  isPymthouseSeedEnabled,
} from './provider-config';

describe('NAAP-0 — BillingProvider seed verify', () => {
  it('seeds BillingProvider{slug:pymthouse, enabled:true}', () => {
    const seed = findPymthouseSeed(BILLING_PROVIDERS);
    expect(seed).toBeDefined();
    expect(seed?.slug).toBe(PYMTHOUSE_PROVIDER_SLUG);
    expect(seed?.enabled).toBe(true);
    expect(isPymthouseSeedEnabled(BILLING_PROVIDERS)).toBe(true);
  });
});

describe('NAAP-0 — PYMTHOUSE_* env wiring', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const name of PYMTHOUSE_ENV_VARS) {
      saved[name] = process.env[name];
      delete process.env[name];
    }
  });

  afterEach(() => {
    for (const name of PYMTHOUSE_ENV_VARS) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  });

  it('reports all vars missing and not configured when env is empty', () => {
    const status = verifyPymthouseEnv();
    expect(status.configured).toBe(false);
    expect(status.missing).toEqual([...PYMTHOUSE_ENV_VARS]);
    expect(Object.values(status.present).every((v) => v === false)).toBe(true);
  });

  it('reports configured + staging match for valid staging wiring', () => {
    process.env.PYMTHOUSE_ISSUER_URL = `${PYMTHOUSE_STAGING_ISSUER_ORIGIN}/api/v1/oidc`;
    process.env.PYMTHOUSE_PUBLIC_CLIENT_ID = PYMTHOUSE_STAGING_CLIENT_ID;
    process.env.PYMTHOUSE_M2M_CLIENT_ID = PYMTHOUSE_STAGING_CLIENT_ID;
    process.env.PYMTHOUSE_M2M_CLIENT_SECRET = 'test-only-secret-not-real';

    const status = verifyPymthouseEnv();
    expect(status.configured).toBe(true);
    expect(status.missing).toEqual([]);
    expect(status.issuerMatchesStaging).toBe(true);
    expect(status.clientIdMatchesStaging).toBe(true);
  });

  it('flags only the missing secret when the rest is present', () => {
    process.env.PYMTHOUSE_ISSUER_URL = `${PYMTHOUSE_STAGING_ISSUER_ORIGIN}/api/v1/oidc`;
    process.env.PYMTHOUSE_PUBLIC_CLIENT_ID = PYMTHOUSE_STAGING_CLIENT_ID;
    process.env.PYMTHOUSE_M2M_CLIENT_ID = PYMTHOUSE_STAGING_CLIENT_ID;

    const status = verifyPymthouseEnv();
    expect(status.configured).toBe(false);
    expect(status.missing).toEqual(['PYMTHOUSE_M2M_CLIENT_SECRET']);
    expect(status.present.PYMTHOUSE_M2M_CLIENT_SECRET).toBe(false);
  });

  it('NEVER leaks the secret value via the structured log line', () => {
    const secret = 'super-secret-value-should-never-appear';
    process.env.PYMTHOUSE_ISSUER_URL = `${PYMTHOUSE_STAGING_ISSUER_ORIGIN}/api/v1/oidc`;
    process.env.PYMTHOUSE_PUBLIC_CLIENT_ID = PYMTHOUSE_STAGING_CLIENT_ID;
    process.env.PYMTHOUSE_M2M_CLIENT_ID = PYMTHOUSE_STAGING_CLIENT_ID;
    process.env.PYMTHOUSE_M2M_CLIENT_SECRET = secret;

    const lines: string[] = [];
    const status = logPymthouseEnvStatus({ info: (m) => lines.push(m) }, 'test-correlation-id');

    expect(status.configured).toBe(true);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('test-correlation-id');
    expect(lines[0]).toContain('"present"');
    // The secret value must NOT appear anywhere in the emitted log line.
    expect(lines[0]).not.toContain(secret);
  });
});
