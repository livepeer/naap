/**
 * Tests for src/lib/monitoring.ts — structured error reporter.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { reportError, __resetMonitoringForTests } from '@/lib/monitoring';

describe('reportError', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let originalSentryDsn: string | undefined;

  beforeEach(() => {
    __resetMonitoringForTests();
    originalSentryDsn = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    if (originalSentryDsn === undefined) {
      delete process.env.SENTRY_DSN;
    } else {
      process.env.SENTRY_DSN = originalSentryDsn;
    }
    consoleErrorSpy.mockRestore();
    __resetMonitoringForTests();
  });

  it('emits a structured [ALERT] log line with required fields', () => {
    reportError(new Error('boom'), {
      area: 'auth.email.verification',
      tags: { kind: 'send_failure' },
    });

    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    const arg = consoleErrorSpy.mock.calls[0][0] as string;
    expect(arg.startsWith('[ALERT] ')).toBe(true);

    const payload = JSON.parse(arg.slice('[ALERT] '.length));
    expect(payload).toMatchObject({
      level: 'error',
      area: 'auth.email.verification',
      name: 'Error',
      message: 'boom',
      tags: { kind: 'send_failure' },
    });
    expect(typeof payload.timestamp).toBe('string');
  });

  it('strips newlines and control characters from message (log-injection guard)', () => {
    reportError(new Error('line1\nline2\rline3\x1b[31m'), {
      area: 'auth.email.verification',
    });
    const arg = consoleErrorSpy.mock.calls[0][0] as string;
    const payload = JSON.parse(arg.slice('[ALERT] '.length));
    expect(payload.message).not.toContain('\n');
    expect(payload.message).not.toContain('\r');
    expect(payload.message).not.toMatch(/\x1b/);
  });

  it('accepts non-Error values (string, object) without throwing', () => {
    expect(() =>
      reportError('plain-string', { area: 'a' }),
    ).not.toThrow();
    expect(() =>
      reportError({ weird: true } as unknown, { area: 'a' }),
    ).not.toThrow();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(2);
  });

  it('does not throw when Sentry is not installed and SENTRY_DSN is set', async () => {
    process.env.SENTRY_DSN = 'https://example.invalid/123';
    __resetMonitoringForTests();
    expect(() =>
      reportError(new Error('x'), { area: 'auth.email.verification' }),
    ).not.toThrow();
    // Flush microtasks so the dynamic-import path resolves.
    await new Promise((r) => setTimeout(r, 0));
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
