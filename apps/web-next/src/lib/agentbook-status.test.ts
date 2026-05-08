/**
 * Tests for the /status snapshot helper (PR 22).
 *
 * Maya types `/status` and the bot replies with a one-glance health
 * panel: bot connected, database latency, last bank sync, last morning
 * digest, open CPA requests, recent error events. Same payload feeds
 * the GET /agentbook-core/status web endpoint.
 *
 * Pinned guarantees:
 *   1. Aggregates the right buckets — bank sync timestamp, last
 *      digest-send AbEvent, open AbAccountantRequest count, recent
 *      AbAuditEvent rows whose `action` starts with "error.".
 *   2. Tenant scoping — every Prisma call is filtered by tenantId; a
 *      sibling tenant's bank account / digest event / CPA request must
 *      NOT bleed into the snapshot.
 *   3. Database health — the helper measures its own latency to a tiny
 *      probe query and returns `database.ok=true` on success.
 *   4. Empty state — when the tenant has nothing (no bank accounts, no
 *      digest sent, no CPA, no errors), the helper returns sensible
 *      nulls/zeros (not throws, not undefined).
 *   5. Recent errors are capped at 3 (the renderer assumes ≤3 lines).
 *
 * Pure unit-style: the Prisma client is mocked at the module boundary.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@naap/database', () => {
  return {
    prisma: {
      $queryRaw: vi.fn(),
      abBankAccount: {
        count: vi.fn(),
        findFirst: vi.fn(),
      },
      abEvent: {
        findFirst: vi.fn(),
      },
      abAccountantRequest: {
        count: vi.fn(),
      },
      abAuditEvent: {
        findMany: vi.fn(),
      },
    },
  };
});

import { prisma as db } from '@naap/database';
import { getStatusSnapshot } from './agentbook-status';

const mockedDb = db as unknown as {
  $queryRaw: ReturnType<typeof vi.fn>;
  abBankAccount: {
    count: ReturnType<typeof vi.fn>;
    findFirst: ReturnType<typeof vi.fn>;
  };
  abEvent: { findFirst: ReturnType<typeof vi.fn> };
  abAccountantRequest: { count: ReturnType<typeof vi.fn> };
  abAuditEvent: { findMany: ReturnType<typeof vi.fn> };
};

const TENANT = 'tenant-A';

beforeEach(() => {
  for (const m of [
    mockedDb.$queryRaw,
    mockedDb.abBankAccount.count,
    mockedDb.abBankAccount.findFirst,
    mockedDb.abEvent.findFirst,
    mockedDb.abAccountantRequest.count,
    mockedDb.abAuditEvent.findMany,
  ]) {
    m.mockReset();
  }
  // Default: db probe succeeds.
  mockedDb.$queryRaw.mockResolvedValue([{ ok: 1 }]);
});

describe('getStatusSnapshot — happy path', () => {
  it('aggregates bot, db, bank, digest, CPA and recent errors', async () => {
    const lastSync = new Date('2026-05-06T10:00:00Z');
    const lastDigest = new Date('2026-05-06T07:03:00Z');
    const errAt = new Date('2026-05-06T11:00:00Z');

    mockedDb.abBankAccount.count.mockResolvedValue(2);
    mockedDb.abBankAccount.findFirst.mockResolvedValue({ lastSynced: lastSync });
    mockedDb.abEvent.findFirst.mockResolvedValue({ createdAt: lastDigest });
    mockedDb.abAccountantRequest.count.mockResolvedValue(1);
    mockedDb.abAuditEvent.findMany.mockResolvedValue([
      { createdAt: errAt, action: 'error.bank_sync_failed' },
      { createdAt: new Date(errAt.getTime() - 60_000), action: 'error.invoice_send' },
    ]);

    const snap = await getStatusSnapshot(TENANT);

    expect(snap.bot.ok).toBe(true);
    expect(snap.database.ok).toBe(true);
    expect(typeof snap.database.latencyMs).toBe('number');
    expect(snap.database.latencyMs).toBeGreaterThanOrEqual(0);
    expect(snap.bankSync.connectedAccounts).toBe(2);
    expect(snap.bankSync.lastSyncedAt).toEqual(lastSync);
    expect(snap.morningDigest.lastSentAt).toEqual(lastDigest);
    expect(snap.cpaRequests.open).toBe(1);
    expect(snap.recentErrors).toHaveLength(2);
    expect(snap.recentErrors[0].eventType).toBe('error.bank_sync_failed');
    expect(snap.recentErrors[0].when).toEqual(errAt);
  });
});

describe('getStatusSnapshot — tenant scoping', () => {
  it('every query is filtered by tenantId — cross-tenant rows cannot leak', async () => {
    mockedDb.abBankAccount.count.mockResolvedValue(0);
    mockedDb.abBankAccount.findFirst.mockResolvedValue(null);
    mockedDb.abEvent.findFirst.mockResolvedValue(null);
    mockedDb.abAccountantRequest.count.mockResolvedValue(0);
    mockedDb.abAuditEvent.findMany.mockResolvedValue([]);

    await getStatusSnapshot(TENANT);

    expect(mockedDb.abBankAccount.count.mock.calls[0][0].where.tenantId).toBe(TENANT);
    expect(mockedDb.abBankAccount.findFirst.mock.calls[0][0].where.tenantId).toBe(TENANT);
    expect(mockedDb.abEvent.findFirst.mock.calls[0][0].where.tenantId).toBe(TENANT);
    expect(mockedDb.abAccountantRequest.count.mock.calls[0][0].where.tenantId).toBe(TENANT);
    expect(mockedDb.abAuditEvent.findMany.mock.calls[0][0].where.tenantId).toBe(TENANT);
  });
});

describe('getStatusSnapshot — empty state', () => {
  it('returns nulls / zeros when the tenant has no activity', async () => {
    mockedDb.abBankAccount.count.mockResolvedValue(0);
    mockedDb.abBankAccount.findFirst.mockResolvedValue(null);
    mockedDb.abEvent.findFirst.mockResolvedValue(null);
    mockedDb.abAccountantRequest.count.mockResolvedValue(0);
    mockedDb.abAuditEvent.findMany.mockResolvedValue([]);

    const snap = await getStatusSnapshot(TENANT);

    expect(snap.bankSync).toEqual({ lastSyncedAt: null, connectedAccounts: 0 });
    expect(snap.morningDigest).toEqual({ lastSentAt: null });
    expect(snap.cpaRequests).toEqual({ open: 0 });
    expect(snap.recentErrors).toEqual([]);
    // Bot health is determined by env — usernameKnown reflects whether
    // we can resolve a bot username; ok stays true for the in-process
    // health probe.
    expect(snap.bot.ok).toBe(true);
    expect(typeof snap.bot.usernameKnown).toBe('boolean');
  });
});

describe('getStatusSnapshot — db probe failure is sanitised', () => {
  it('marks database.ok=false when the probe throws — does not crash the snapshot', async () => {
    mockedDb.$queryRaw.mockRejectedValue(new Error('connection reset'));
    mockedDb.abBankAccount.count.mockResolvedValue(0);
    mockedDb.abBankAccount.findFirst.mockResolvedValue(null);
    mockedDb.abEvent.findFirst.mockResolvedValue(null);
    mockedDb.abAccountantRequest.count.mockResolvedValue(0);
    mockedDb.abAuditEvent.findMany.mockResolvedValue([]);

    const snap = await getStatusSnapshot(TENANT);

    expect(snap.database.ok).toBe(false);
    // The rest of the snapshot should still populate (best-effort).
    expect(snap.cpaRequests.open).toBe(0);
  });
});

describe('getStatusSnapshot — error filter', () => {
  it('queries AbAuditEvent with action prefix "error." and caps results at 3', async () => {
    mockedDb.abBankAccount.count.mockResolvedValue(0);
    mockedDb.abBankAccount.findFirst.mockResolvedValue(null);
    mockedDb.abEvent.findFirst.mockResolvedValue(null);
    mockedDb.abAccountantRequest.count.mockResolvedValue(0);
    mockedDb.abAuditEvent.findMany.mockResolvedValue([]);

    await getStatusSnapshot(TENANT);

    const args = mockedDb.abAuditEvent.findMany.mock.calls[0][0];
    expect(args.where.tenantId).toBe(TENANT);
    // Prefix filter: action LIKE 'error.%' translates to a startsWith.
    expect(args.where.action).toMatchObject({ startsWith: 'error.' });
    expect(args.take).toBe(3);
    // Most-recent first.
    expect(args.orderBy).toMatchObject({ createdAt: 'desc' });
  });
});

describe('getStatusSnapshot — digest event lookup', () => {
  it('looks for the most-recent morning-digest send event', async () => {
    mockedDb.abBankAccount.count.mockResolvedValue(0);
    mockedDb.abBankAccount.findFirst.mockResolvedValue(null);
    mockedDb.abEvent.findFirst.mockResolvedValue(null);
    mockedDb.abAccountantRequest.count.mockResolvedValue(0);
    mockedDb.abAuditEvent.findMany.mockResolvedValue([]);

    await getStatusSnapshot(TENANT);

    const args = mockedDb.abEvent.findFirst.mock.calls[0][0];
    expect(args.where.tenantId).toBe(TENANT);
    // Either the bank-review or deduction stamp counts as "digest sent
    // today" — accept either via an `in` filter so future event types
    // can be added without breaking the helper.
    const eventTypeFilter = args.where.eventType;
    expect(typeof eventTypeFilter === 'object' && eventTypeFilter !== null).toBe(true);
    expect(args.orderBy).toMatchObject({ createdAt: 'desc' });
  });
});
