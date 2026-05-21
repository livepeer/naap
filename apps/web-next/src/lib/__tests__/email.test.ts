/**
 * Tests for src/lib/email.ts — config validation paths.
 *
 * Note: the runtime senders themselves are exercised by Playwright smoke
 * tests against a deployed environment.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

describe('validateEmailConfig', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  it('returns configured=false and warning when RESEND_API_KEY missing', async () => {
    delete process.env.RESEND_API_KEY;
    delete process.env.EMAIL_FROM;
    const mod = await import('@/lib/email');
    const result = mod.validateEmailConfig();
    expect(result.configured).toBe(false);
    expect(result.warnings.some((w) => w.includes('RESEND_API_KEY'))).toBe(true);
  });

  it('returns configured=false when EMAIL_FROM still uses sandbox domain', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.EMAIL_FROM = 'NaaP <onboarding@resend.dev>';
    const mod = await import('@/lib/email');
    const result = mod.validateEmailConfig();
    expect(result.configured).toBe(false);
    expect(result.warnings.some((w) => w.includes('sandbox'))).toBe(true);
  });

  it('returns configured=true with no warnings when fully set up', async () => {
    process.env.RESEND_API_KEY = 're_test_key';
    process.env.EMAIL_FROM = 'NaaP <noreply@operator.livepeer.org>';
    const mod = await import('@/lib/email');
    const result = mod.validateEmailConfig();
    expect(result.configured).toBe(true);
    expect(result.warnings).toEqual([]);
  });

  it('is pure: calling it does not log to console', async () => {
    process.env.RESEND_API_KEY = '';
    process.env.EMAIL_FROM = 'NaaP <onboarding@resend.dev>';
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const mod = await import('@/lib/email');
    errorSpy.mockClear();
    warnSpy.mockClear();
    mod.validateEmailConfig();
    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).not.toHaveBeenCalled();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });
});
