/**
 * E2E for soft-delete on financial entities (PR 26).
 *
 * The contract:
 *   - DELETE on a financial entity sets `deletedAt` instead of removing
 *     the row (verified by reading directly from the DB).
 *   - Default list/detail responses exclude soft-deleted rows.
 *   - `?includeDeleted=true` opts back in.
 *   - POST /agentbook-core/restore/:type/:id within 90 days clears
 *     `deletedAt` and the row is live again.
 *   - The same restore endpoint returns 422 once the soft-delete is
 *     older than 90 days.
 *   - The /agentbook/cron/purge-deleted cron hard-deletes rows past
 *     the 90-day window.
 *
 * Each test owns a fresh expense (or two) so they can run in any order.
 * Cleanup at the end nukes everything keyed by our synthetic tenant id.
 */

import { test, expect } from '@playwright/test';

const WEB = 'http://localhost:3000';
const TENANT = `e2e-pr26-soft-delete-${Date.now()}`;

let prisma: typeof import('@naap/database').prisma;

interface ApiResponse<T = unknown> {
  success?: boolean;
  data?: T;
  error?: string;
  meta?: unknown;
}

async function seedExpense(opts: {
  description: string;
  deletedAt?: Date | null;
}): Promise<{ id: string }> {
  return prisma.abExpense.create({
    data: {
      tenantId: TENANT,
      amountCents: 1234,
      date: new Date(),
      description: opts.description,
      paymentMethod: 'card',
      currency: 'USD',
      deletedAt: opts.deletedAt ?? null,
    },
    select: { id: true },
  });
}

test.describe.serial('PR 26 — Soft-delete on financial entities', () => {
  test.beforeAll(async () => {
    const dbMod = await import('@naap/database');
    prisma = dbMod.prisma;
  });

  test.afterAll(async () => {
    if (!prisma) return;
    await prisma.abExpense.deleteMany({ where: { tenantId: TENANT } });
    await prisma.$disconnect();
  });

  test('DELETE on an expense soft-deletes (sets deletedAt) instead of removing', async ({ request }) => {
    const seeded = await seedExpense({ description: 'pr26-delete-soft' });

    const res = await request.delete(`${WEB}/api/v1/agentbook-expense/expenses/${seeded.id}`, {
      headers: { 'x-tenant-id': TENANT },
    });
    expect(res.ok()).toBeTruthy();

    const row = await prisma.abExpense.findUnique({ where: { id: seeded.id } });
    expect(row).not.toBeNull();
    expect(row?.deletedAt).not.toBeNull();
  });

  test('list endpoint excludes soft-deleted by default', async ({ request }) => {
    const live = await seedExpense({ description: 'pr26-list-live' });
    const dead = await seedExpense({ description: 'pr26-list-dead', deletedAt: new Date() });

    const res = await request.get(`${WEB}/api/v1/agentbook-expense/expenses`, {
      headers: { 'x-tenant-id': TENANT },
    });
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as ApiResponse<Array<{ id: string }>>;
    const ids = (body.data || []).map((e) => e.id);
    expect(ids).toContain(live.id);
    expect(ids).not.toContain(dead.id);
  });

  test('?includeDeleted=true exposes soft-deleted rows', async ({ request }) => {
    const dead = await seedExpense({ description: 'pr26-include-dead', deletedAt: new Date() });

    const res = await request.get(`${WEB}/api/v1/agentbook-expense/expenses?includeDeleted=true`, {
      headers: { 'x-tenant-id': TENANT },
    });
    expect(res.ok()).toBeTruthy();
    const body = (await res.json()) as ApiResponse<Array<{ id: string; deletedAt: string | null }>>;
    const found = (body.data || []).find((e) => e.id === dead.id);
    expect(found).toBeDefined();
    expect(found?.deletedAt).toBeTruthy();
  });

  test('detail endpoint 404s for soft-deleted by default; ?includeDeleted=true returns it', async ({ request }) => {
    const dead = await seedExpense({ description: 'pr26-detail-dead', deletedAt: new Date() });

    const r1 = await request.get(`${WEB}/api/v1/agentbook-expense/expenses/${dead.id}`, {
      headers: { 'x-tenant-id': TENANT },
    });
    expect(r1.status()).toBe(404);

    const r2 = await request.get(
      `${WEB}/api/v1/agentbook-expense/expenses/${dead.id}?includeDeleted=true`,
      { headers: { 'x-tenant-id': TENANT } },
    );
    expect(r2.ok()).toBeTruthy();
  });

  test('restore endpoint clears deletedAt within the 90-day window', async ({ request }) => {
    const dead = await seedExpense({
      description: 'pr26-restore-fresh',
      deletedAt: new Date(),
    });

    const res = await request.post(
      `${WEB}/api/v1/agentbook-core/restore/expense/${dead.id}`,
      { headers: { 'x-tenant-id': TENANT } },
    );
    expect(res.ok()).toBeTruthy();

    const row = await prisma.abExpense.findUnique({ where: { id: dead.id } });
    expect(row?.deletedAt).toBeNull();
  });

  test('restore endpoint returns 422 once soft-deleted >90 days', async ({ request }) => {
    const long = new Date(Date.now() - 100 * 24 * 60 * 60 * 1000); // 100d ago
    const dead = await seedExpense({ description: 'pr26-restore-stale', deletedAt: long });

    const res = await request.post(
      `${WEB}/api/v1/agentbook-core/restore/expense/${dead.id}`,
      { headers: { 'x-tenant-id': TENANT } },
    );
    expect(res.status()).toBe(422);

    // The row is still in the DB (cron hasn't fired); deletedAt is unchanged.
    const row = await prisma.abExpense.findUnique({ where: { id: dead.id } });
    expect(row?.deletedAt?.toISOString()).toBe(long.toISOString());
  });

  test('purge-deleted cron hard-deletes rows past the 90-day window', async ({ request }) => {
    const stale = await seedExpense({
      description: 'pr26-purge-stale',
      deletedAt: new Date(Date.now() - 100 * 24 * 60 * 60 * 1000),
    });
    const fresh = await seedExpense({
      description: 'pr26-purge-fresh',
      deletedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });

    // Bearer-gated when CRON_SECRET is set; in test env it's typically
    // unset so the gate is open. Skip the test if the env enforces it
    // and we don't have the secret to hand.
    const res = await request.get(`${WEB}/api/v1/agentbook/cron/purge-deleted`);
    if (res.status() === 401) {
      test.info().annotations.push({
        type: 'skip-reason',
        description: 'CRON_SECRET set; skipping purge-cron run.',
      });
      return;
    }
    expect(res.ok()).toBeTruthy();

    const stillStale = await prisma.abExpense.findUnique({ where: { id: stale.id } });
    expect(stillStale).toBeNull(); // hard-deleted

    const stillFresh = await prisma.abExpense.findUnique({ where: { id: fresh.id } });
    expect(stillFresh).not.toBeNull(); // within 90d, kept
  });
});
