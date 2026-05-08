/**
 * Tests for `withRetry` — the Telegram-webhook retry helper (PR 23).
 *
 * The webhook handler must distinguish transient failures (LLM timeout,
 * brief DB blip) from permanent ones (4xx from the LLM API, malformed
 * input). Transients get exponential backoff up to `maxAttempts`;
 * permanents short-circuit immediately so we don't pile retries onto a
 * call that will keep failing.
 *
 * Contract pinned here:
 *   1. Succeeds first try         — no waits, no extra calls.
 *   2. Retries then succeeds      — second attempt wins.
 *   3. Exhausts retries           — throws the last error after
 *                                   `maxAttempts` calls.
 *   4. Permanent error            — caller's classifier returns
 *                                   `false`; helper does NOT retry.
 *   5. Default classifier         — recognises timeout / ECONN / connect
 *                                   substrings as transient; everything
 *                                   else is permanent.
 *   6. Backoff schedule           — waits the configured ms between
 *                                   attempts (validated via fake timers).
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

import { withRetry } from './agentbook-webhook-retry';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('withRetry', () => {
  it('returns the value on the first try without waiting', async () => {
    const fn = vi.fn().mockResolvedValue('ok');

    const p = withRetry(fn);
    // No timers were scheduled — first call resolves immediately.
    await expect(p).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on a transient error then succeeds', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('connect ECONNREFUSED 127.0.0.1:5432'))
      .mockResolvedValueOnce('healed');

    const p = withRetry(fn, { backoffMs: [10, 20, 30] });

    // Drain the scheduled backoff sleep(s).
    await vi.runAllTimersAsync();

    await expect(p).resolves.toBe('healed');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('exhausts all attempts and throws the last error', async () => {
    const last = new Error('timeout after 25s');
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('connect ETIMEDOUT'))
      .mockRejectedValueOnce(new Error('timeout 1'))
      .mockRejectedValueOnce(last);

    const p = withRetry(fn, { maxAttempts: 3, backoffMs: [1, 2] }).catch(
      (e) => e,
    );

    await vi.runAllTimersAsync();
    const caught = await p;

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/timeout after 25s/);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry when the caller classifies the error as permanent', async () => {
    const fn = vi.fn().mockRejectedValue(
      Object.assign(new Error('400 Bad Request from LLM'), { status: 400 }),
    );
    const isTransient = vi.fn().mockReturnValue(false);

    const p = withRetry(fn, {
      isTransient,
      maxAttempts: 3,
      backoffMs: [1, 1],
    }).catch((e) => e);
    await vi.runAllTimersAsync();
    const caught = await p;

    expect((caught as Error).message).toMatch(/Bad Request/);
    // One attempt, then bail out.
    expect(fn).toHaveBeenCalledTimes(1);
    expect(isTransient).toHaveBeenCalledTimes(1);
  });

  it("the default classifier treats 'timeout' / ECONN / connect as transient and other messages as permanent", async () => {
    // Permanent: arbitrary message — should NOT retry.
    const permanent = vi.fn().mockRejectedValue(new Error('400 invalid_request'));
    const p1 = withRetry(permanent, {
      maxAttempts: 5,
      backoffMs: [1, 1, 1, 1],
    }).catch((e) => e);
    await vi.runAllTimersAsync();
    const caught1 = await p1;
    expect((caught1 as Error).message).toMatch(/invalid_request/);
    expect(permanent).toHaveBeenCalledTimes(1);

    // Transient: 'timeout' — SHOULD retry.
    const transient = vi
      .fn()
      .mockRejectedValueOnce(new Error('LLM timeout'))
      .mockResolvedValueOnce('ok');
    const p2 = withRetry(transient, { maxAttempts: 3, backoffMs: [1, 1] });
    await vi.runAllTimersAsync();
    await expect(p2).resolves.toBe('ok');
    expect(transient).toHaveBeenCalledTimes(2);
  });

  it('honours the configured backoff schedule (waits between attempts)', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new Error('timeout #1'))
      .mockRejectedValueOnce(new Error('timeout #2'))
      .mockResolvedValueOnce('ok');

    const p = withRetry(fn, { maxAttempts: 3, backoffMs: [100, 500] });

    // Before any timers advance: the first attempt has already fired
    // (synchronous microtask), then we schedule 100ms.
    await Promise.resolve();
    await Promise.resolve();
    expect(fn).toHaveBeenCalledTimes(1);

    // Advance 100ms — second attempt fires.
    await vi.advanceTimersByTimeAsync(100);
    expect(fn).toHaveBeenCalledTimes(2);

    // Advance 500ms — third attempt fires (and resolves).
    await vi.advanceTimersByTimeAsync(500);
    await expect(p).resolves.toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('caps attempts at backoffMs.length + 1 when maxAttempts is larger', async () => {
    // backoffMs has 1 entry → at most 2 attempts (initial + 1 retry).
    const fn = vi.fn().mockRejectedValue(new Error('timeout'));
    const p = withRetry(fn, { maxAttempts: 99, backoffMs: [1] }).catch(
      (e) => e,
    );
    await vi.runAllTimersAsync();
    const caught = await p;
    expect((caught as Error).message).toMatch(/timeout/);
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
