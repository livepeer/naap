/**
 * Tests for the Telegram-webhook idempotency helper (PR 21).
 *
 * Telegram retries webhook deliveries when the receiver times out or
 * returns 5xx. Without dedup, a retry can double-book an expense or
 * re-send an invoice. The helper claims a key (`tg_update:<update_id>`
 * or `tg_callback:<callback_query_id>`) at the very top of the POST
 * handler — first call wins, replays short-circuit.
 *
 * These tests pin the contract:
 *   1. claimKey — first call returns true (and writes a row).
 *   2. claimKey — second call collides on the unique PK (Prisma P2002)
 *      and returns false; the caller short-circuits.
 *   3. claimKey — non-P2002 errors propagate (don't silently swallow).
 *   4. recordResponse — writes the cached body for the existing row.
 *   5. getCachedResponse — returns the cached body on a replay.
 *   6. getCachedResponse — returns null for an unclaimed key.
 *
 * Pure unit-style: the Prisma client is mocked at the module boundary.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@naap/database', () => {
  return {
    prisma: {
      abIdempotencyKey: {
        create: vi.fn(),
        update: vi.fn(),
        findUnique: vi.fn(),
        deleteMany: vi.fn(),
      },
    },
  };
});

import { prisma as db } from '@naap/database';
import {
  claimKey,
  recordResponse,
  getCachedResponse,
  pruneIdempotencyKeys,
} from './agentbook-idempotency';

const mockedDb = db as unknown as {
  abIdempotencyKey: {
    create: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
    deleteMany: ReturnType<typeof vi.fn>;
  };
};

const TENANT_A = 'tenant-A';
const KEY = 'tg_update:42';

beforeEach(() => {
  mockedDb.abIdempotencyKey.create.mockReset();
  mockedDb.abIdempotencyKey.update.mockReset();
  mockedDb.abIdempotencyKey.findUnique.mockReset();
  mockedDb.abIdempotencyKey.deleteMany.mockReset();
});

describe('claimKey', () => {
  it('returns true on the first claim and writes a row scoped to the tenant', async () => {
    mockedDb.abIdempotencyKey.create.mockResolvedValue({
      key: KEY,
      tenantId: TENANT_A,
      response: null,
      createdAt: new Date(),
    });

    const ok = await claimKey(KEY, TENANT_A);

    expect(ok).toBe(true);
    expect(mockedDb.abIdempotencyKey.create).toHaveBeenCalledTimes(1);
    const args = mockedDb.abIdempotencyKey.create.mock.calls[0][0];
    expect(args.data).toMatchObject({ key: KEY, tenantId: TENANT_A });
  });

  it('returns false when the key already exists (Prisma P2002 race)', async () => {
    // Simulate the second-arriver losing the unique-PK race.
    const p2002 = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
    });
    mockedDb.abIdempotencyKey.create.mockRejectedValue(p2002);

    const ok = await claimKey(KEY, TENANT_A);

    expect(ok).toBe(false);
    expect(mockedDb.abIdempotencyKey.create).toHaveBeenCalledTimes(1);
  });

  it('rethrows non-P2002 errors so real DB problems are not silently swallowed', async () => {
    mockedDb.abIdempotencyKey.create.mockRejectedValue(
      Object.assign(new Error('connection refused'), { code: 'P1001' }),
    );

    await expect(claimKey(KEY, TENANT_A)).rejects.toThrow(/connection refused/);
  });
});

describe('recordResponse', () => {
  it('updates the existing row with the cached response payload', async () => {
    mockedDb.abIdempotencyKey.update.mockResolvedValue({});

    await recordResponse(KEY, { ok: true, foo: 'bar' });

    expect(mockedDb.abIdempotencyKey.update).toHaveBeenCalledTimes(1);
    const args = mockedDb.abIdempotencyKey.update.mock.calls[0][0];
    expect(args.where).toEqual({ key: KEY });
    expect(args.data).toEqual({ response: { ok: true, foo: 'bar' } });
  });

  it('swallows update errors — caching the response is best-effort', async () => {
    // The original side effects already ran; if we can't write the
    // cache, the worst case is the replay returns a generic idempotent
    // marker instead of the original body. Don't blow up the request.
    mockedDb.abIdempotencyKey.update.mockRejectedValue(new Error('db hiccup'));

    await expect(
      recordResponse(KEY, { ok: true }),
    ).resolves.toBeUndefined();
  });
});

describe('getCachedResponse', () => {
  it('returns the cached response payload for a previously-claimed key', async () => {
    mockedDb.abIdempotencyKey.findUnique.mockResolvedValue({
      key: KEY,
      tenantId: TENANT_A,
      response: { ok: true, idempotent: true, original: 'reply' },
      createdAt: new Date(),
    });

    const r = await getCachedResponse(KEY);

    expect(r).toEqual({ ok: true, idempotent: true, original: 'reply' });
    expect(mockedDb.abIdempotencyKey.findUnique).toHaveBeenCalledWith({
      where: { key: KEY },
    });
  });

  it('returns null for an unclaimed key', async () => {
    mockedDb.abIdempotencyKey.findUnique.mockResolvedValue(null);

    const r = await getCachedResponse('tg_update:does-not-exist');

    expect(r).toBeNull();
  });

  it('returns null when the row exists but no response was cached yet', async () => {
    mockedDb.abIdempotencyKey.findUnique.mockResolvedValue({
      key: KEY,
      tenantId: TENANT_A,
      response: null,
      createdAt: new Date(),
    });

    const r = await getCachedResponse(KEY);

    expect(r).toBeNull();
  });
});

describe('pruneIdempotencyKeys', () => {
  it('deletes rows older than the cutoff (default 1 day) and returns the count', async () => {
    mockedDb.abIdempotencyKey.deleteMany.mockResolvedValue({ count: 12 });

    const before = Date.now();
    const r = await pruneIdempotencyKeys();
    const after = Date.now();

    expect(r).toEqual({ deleted: 12 });
    expect(mockedDb.abIdempotencyKey.deleteMany).toHaveBeenCalledTimes(1);
    const args = mockedDb.abIdempotencyKey.deleteMany.mock.calls[0][0];
    const cutoff: Date = args.where.createdAt.lt;
    const expectedMin = before - 86_400_000 - 1000;
    const expectedMax = after - 86_400_000 + 1000;
    expect(cutoff.getTime()).toBeGreaterThanOrEqual(expectedMin);
    expect(cutoff.getTime()).toBeLessThanOrEqual(expectedMax);
  });

  it('honours a custom retention window (in hours)', async () => {
    mockedDb.abIdempotencyKey.deleteMany.mockResolvedValue({ count: 5 });

    const r = await pruneIdempotencyKeys({ olderThanHours: 6 });

    expect(r).toEqual({ deleted: 5 });
    const args = mockedDb.abIdempotencyKey.deleteMany.mock.calls[0][0];
    const cutoff: Date = args.where.createdAt.lt;
    const sixHoursAgo = Date.now() - 6 * 3_600_000;
    expect(Math.abs(cutoff.getTime() - sixHoursAgo)).toBeLessThan(2_000);
  });
});
