/**
 * Tests for the bot rate-limit helper (PR 25).
 *
 * Per-tenant ceilings on inbound bot messages — 60/minute and 1000/day
 * by default. Beyond the limits we throttle with a polite reply rather
 * than dropping the request silently.
 *
 * The helper stores its sliding-window counters in `AbUserMemory` rows
 * keyed by `rate:<channel>:minute` and `rate:<channel>:day`. Each row's
 * `value` is JSON `{ "bucket": <epoch-ms-bucket>, "count": <int> }`.
 * When `checkAndIncrement` runs in a different bucket than what's
 * stored, the count resets — that's how the sliding-window-by-bucket
 * resets cleanly across minute and UTC-day boundaries.
 *
 * These tests pin the contract:
 *   1. Allow under both ceilings (default 60/min, 1000/day).
 *   2. Deny on the 61st message in the same minute, with reason='minute'
 *      and a sub-minute retryAfterMs.
 *   3. Deny on the 1001st message in the same UTC day, with
 *      reason='day' (even when minute counter is fresh).
 *   4. Reset across a minute boundary — same tenant, new minute,
 *      counter starts at 1.
 *   5. Reset across a UTC-day boundary — same tenant, new day,
 *      day counter starts at 1.
 *   6. Custom config overrides defaults (per-tenant ceilings).
 *   7. Channel scope — telegram counter does not affect web counter.
 *
 * Pure unit-style: the Prisma client is mocked at the module boundary
 * so the test suite stays fast and DB-free.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@naap/database', () => {
  return {
    prisma: {
      abUserMemory: {
        findUnique: vi.fn(),
        upsert: vi.fn(),
      },
    },
  };
});

import { prisma as db } from '@naap/database';
import { checkAndIncrement } from './agentbook-rate-limit';

const mockedDb = db as unknown as {
  abUserMemory: {
    findUnique: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
  };
};

const TENANT = 'tenant-A';
const CHANNEL = 'telegram';

// In-memory store keyed by tenantId+key — replays the unique
// `(tenantId, key)` index so the test sequence behaves like a real DB.
type Row = {
  tenantId: string;
  key: string;
  value: string;
  type: string;
};
const store = new Map<string, Row>();

function rowKey(tenantId: string, key: string): string {
  return `${tenantId}|${key}`;
}

beforeEach(() => {
  store.clear();
  mockedDb.abUserMemory.findUnique.mockReset();
  mockedDb.abUserMemory.upsert.mockReset();

  mockedDb.abUserMemory.findUnique.mockImplementation(async (args: {
    where: { tenantId_key: { tenantId: string; key: string } };
  }) => {
    const { tenantId, key } = args.where.tenantId_key;
    return store.get(rowKey(tenantId, key)) ?? null;
  });

  mockedDb.abUserMemory.upsert.mockImplementation(async (args: {
    where: { tenantId_key: { tenantId: string; key: string } };
    create: { tenantId: string; key: string; value: string; type: string };
    update: { value: string };
  }) => {
    const { tenantId, key } = args.where.tenantId_key;
    const k = rowKey(tenantId, key);
    const existing = store.get(k);
    if (existing) {
      const next = { ...existing, value: args.update.value };
      store.set(k, next);
      return next;
    }
    const created = {
      tenantId: args.create.tenantId,
      key: args.create.key,
      value: args.create.value,
      type: args.create.type,
    };
    store.set(k, created);
    return created;
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('checkAndIncrement — under limits', () => {
  it('allows the first message and increments to count=1', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-06T12:00:00.000Z'));

    const r = await checkAndIncrement(TENANT, CHANNEL);

    expect(r.allowed).toBe(true);
    expect(r.reason).toBeUndefined();
    // Both rows should now exist and hold count=1.
    const minuteRow = store.get(rowKey(TENANT, `rate:${CHANNEL}:minute`));
    const dayRow = store.get(rowKey(TENANT, `rate:${CHANNEL}:day`));
    expect(minuteRow).toBeTruthy();
    expect(dayRow).toBeTruthy();
    expect(JSON.parse(minuteRow!.value).count).toBe(1);
    expect(JSON.parse(dayRow!.value).count).toBe(1);
  });

  it('allows up to the per-minute ceiling (60 by default)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-06T12:00:00.000Z'));

    for (let i = 0; i < 60; i++) {
      const r = await checkAndIncrement(TENANT, CHANNEL);
      expect(r.allowed).toBe(true);
    }

    const minuteRow = store.get(rowKey(TENANT, `rate:${CHANNEL}:minute`));
    expect(JSON.parse(minuteRow!.value).count).toBe(60);
  });
});

describe('checkAndIncrement — minute denial', () => {
  it('denies the 61st message in the same minute with reason=minute', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-06T12:00:00.000Z'));

    for (let i = 0; i < 60; i++) {
      const r = await checkAndIncrement(TENANT, CHANNEL);
      expect(r.allowed).toBe(true);
    }

    // 61st in the same minute → denied with reason=minute.
    const r = await checkAndIncrement(TENANT, CHANNEL);
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('minute');
    // retryAfterMs should be > 0 and ≤ 60_000 (until next minute boundary).
    expect(r.retryAfterMs).toBeGreaterThan(0);
    expect(r.retryAfterMs).toBeLessThanOrEqual(60_000);
  });

  it('does not increment past the ceiling once denied', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-06T12:00:00.000Z'));

    for (let i = 0; i < 60; i++) {
      await checkAndIncrement(TENANT, CHANNEL);
    }
    await checkAndIncrement(TENANT, CHANNEL);
    await checkAndIncrement(TENANT, CHANNEL);

    const minuteRow = store.get(rowKey(TENANT, `rate:${CHANNEL}:minute`));
    // Counter freezes at the ceiling — extra calls don't push it past 60.
    expect(JSON.parse(minuteRow!.value).count).toBe(60);
  });
});

describe('checkAndIncrement — day denial', () => {
  it('denies on the 1001st message in the same UTC day with reason=day', async () => {
    // Use a tiny minute ceiling so we can exceed the day ceiling without
    // tripping the minute ceiling on every call. Test the day-bound
    // axis in isolation by stepping forward one minute per call.
    vi.useFakeTimers();
    let now = new Date('2026-05-06T00:00:00.000Z').getTime();
    vi.setSystemTime(now);

    for (let i = 0; i < 1000; i++) {
      vi.setSystemTime(now);
      const r = await checkAndIncrement(TENANT, CHANNEL, {
        perMinute: 5,
        perDay: 1000,
      });
      expect(r.allowed).toBe(true);
      now += 60_000; // advance one minute → minute counter resets
    }

    // We're now at 2026-05-06T16:40:00 — still inside the same UTC day.
    // Expect: minute counter fresh (=0), day counter at 1000 → deny with day.
    vi.setSystemTime(now);
    const r = await checkAndIncrement(TENANT, CHANNEL, {
      perMinute: 5,
      perDay: 1000,
    });
    expect(r.allowed).toBe(false);
    expect(r.reason).toBe('day');
  });
});

describe('checkAndIncrement — reset across minute boundary', () => {
  it('resets the minute counter when the next call lands in a new minute', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-06T12:00:30.000Z'));

    // Burn 60 in the first minute so we're right at the ceiling.
    for (let i = 0; i < 60; i++) {
      await checkAndIncrement(TENANT, CHANNEL);
    }

    // Step forward 30s — still in the same minute → still denied.
    vi.setSystemTime(new Date('2026-05-06T12:00:55.000Z'));
    const stillDenied = await checkAndIncrement(TENANT, CHANNEL);
    expect(stillDenied.allowed).toBe(false);

    // Cross the minute boundary — counter resets to 1.
    vi.setSystemTime(new Date('2026-05-06T12:01:00.000Z'));
    const fresh = await checkAndIncrement(TENANT, CHANNEL);
    expect(fresh.allowed).toBe(true);
    const minuteRow = store.get(rowKey(TENANT, `rate:${CHANNEL}:minute`));
    expect(JSON.parse(minuteRow!.value).count).toBe(1);
  });
});

describe('checkAndIncrement — reset across day boundary', () => {
  it('resets the day counter when the next call lands in a new UTC day', async () => {
    vi.useFakeTimers();
    let now = new Date('2026-05-06T00:00:00.000Z').getTime();
    vi.setSystemTime(now);

    // Hammer the day ceiling at the tail end of the UTC day.
    for (let i = 0; i < 1000; i++) {
      vi.setSystemTime(now);
      await checkAndIncrement(TENANT, CHANNEL, {
        perMinute: 5,
        perDay: 1000,
      });
      now += 60_000;
    }

    // Just before midnight UTC — should still be denied (day ceiling).
    vi.setSystemTime(new Date('2026-05-06T23:59:00.000Z'));
    const lastInDay = await checkAndIncrement(TENANT, CHANNEL, {
      perMinute: 5,
      perDay: 1000,
    });
    expect(lastInDay.allowed).toBe(false);
    expect(lastInDay.reason).toBe('day');

    // Cross the UTC-day boundary — both counters reset to 1.
    vi.setSystemTime(new Date('2026-05-07T00:00:00.000Z'));
    const newDay = await checkAndIncrement(TENANT, CHANNEL, {
      perMinute: 5,
      perDay: 1000,
    });
    expect(newDay.allowed).toBe(true);
    const dayRow = store.get(rowKey(TENANT, `rate:${CHANNEL}:day`));
    expect(JSON.parse(dayRow!.value).count).toBe(1);
  });
});

describe('checkAndIncrement — custom config', () => {
  it('honours per-tenant overrides (perMinute and perDay)', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-06T12:00:00.000Z'));

    // Tighter ceiling: 3/min.
    for (let i = 0; i < 3; i++) {
      const r = await checkAndIncrement(TENANT, CHANNEL, {
        perMinute: 3,
        perDay: 1000,
      });
      expect(r.allowed).toBe(true);
    }
    const denied = await checkAndIncrement(TENANT, CHANNEL, {
      perMinute: 3,
      perDay: 1000,
    });
    expect(denied.allowed).toBe(false);
    expect(denied.reason).toBe('minute');
  });
});

describe('checkAndIncrement — channel scope', () => {
  it('scopes counters by channel — telegram and web are independent', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-06T12:00:00.000Z'));

    // Hammer the telegram channel to its ceiling.
    for (let i = 0; i < 60; i++) {
      const r = await checkAndIncrement(TENANT, 'telegram');
      expect(r.allowed).toBe(true);
    }
    const tgDenied = await checkAndIncrement(TENANT, 'telegram');
    expect(tgDenied.allowed).toBe(false);

    // The web channel for the same tenant should be untouched.
    const webOk = await checkAndIncrement(TENANT, 'web');
    expect(webOk.allowed).toBe(true);
    const webRow = store.get(rowKey(TENANT, 'rate:web:minute'));
    expect(JSON.parse(webRow!.value).count).toBe(1);
  });
});

describe('checkAndIncrement — tenant scope', () => {
  it('scopes counters by tenantId — one tenant hitting the ceiling does not affect another', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-06T12:00:00.000Z'));

    for (let i = 0; i < 60; i++) {
      await checkAndIncrement('tenant-A', CHANNEL);
    }
    const denied = await checkAndIncrement('tenant-A', CHANNEL);
    expect(denied.allowed).toBe(false);

    // Different tenant — fresh counters.
    const otherOk = await checkAndIncrement('tenant-B', CHANNEL);
    expect(otherOk.allowed).toBe(true);
  });
});
