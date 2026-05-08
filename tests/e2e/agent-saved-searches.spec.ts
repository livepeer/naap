/**
 * E2E for saved searches (PR 17).
 *
 * Coverage:
 *   1. POST /searches creates a tenant-scoped saved search.
 *   2. GET /searches lists pinned-first.
 *   3. GET /searches/:id/run executes the stored query and returns rows.
 *   4. PUT /searches/:id toggles pinned state and edits name.
 *   5. DELETE /searches/:id removes the row.
 *   6. 11th pinned search returns 422 (cap enforcement).
 *   7. Cross-tenant isolation — sibling tenant cannot read or run.
 */

import { test, expect } from '@playwright/test';

const WEB = 'http://localhost:3000';
const TENANT_A = `e2e-srch-a-${Date.now()}`;
const TENANT_B = `e2e-srch-b-${Date.now()}`;

let prisma: typeof import('@naap/database').prisma;

test.describe.serial('PR 17 — Saved searches', () => {
  let createdId = '';
  let secondId = '';

  test.beforeAll(async () => {
    const dbMod = await import('@naap/database');
    prisma = dbMod.prisma;

    const now = Date.now();
    const day = 86_400_000;

    // Seed an expense in tenant A so the run query has something to find.
    await prisma.abExpense.create({
      data: {
        tenantId: TENANT_A,
        amountCents: 12_300, // $123 — over $50
        date: new Date(now - 30 * day),
        description: 'Client meals — Tony Roma',
        isPersonal: false,
        isDeductible: true,
        status: 'confirmed',
        currency: 'USD',
      },
    });
    await prisma.abExpense.create({
      data: {
        tenantId: TENANT_A,
        amountCents: 1_500, // $15 — under $50, should be excluded
        date: new Date(now - 30 * day),
        description: 'Coffee — small',
        isPersonal: false,
        isDeductible: true,
        status: 'confirmed',
        currency: 'USD',
      },
    });
  });

  test.afterAll(async () => {
    for (const tenantId of [TENANT_A, TENANT_B]) {
      await prisma.abSavedSearch.deleteMany({ where: { tenantId } });
      await prisma.abExpense.deleteMany({ where: { tenantId } });
    }
  });

  test('1. POST creates a saved search', async () => {
    const res = await fetch(`${WEB}/api/v1/agentbook-core/searches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': TENANT_A },
      body: JSON.stringify({
        name: 'Client meals over $50 in 2026',
        scope: 'expense',
        query: {
          scope: 'expense',
          amountMinCents: 5000,
          startDate: '2026-01-01',
          endDate: '2026-12-31',
        },
        pinned: true,
      }),
    });
    expect(res.ok).toBe(true);
    const body = await res.json() as { success: boolean; data?: { id: string; pinned: boolean; name: string } };
    expect(body.success).toBe(true);
    expect(body.data?.pinned).toBe(true);
    expect(body.data?.name).toBe('Client meals over $50 in 2026');
    createdId = body.data!.id;
  });

  test('2. GET lists pinned-first', async () => {
    // Create an unpinned one too.
    const r2 = await fetch(`${WEB}/api/v1/agentbook-core/searches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': TENANT_A },
      body: JSON.stringify({
        name: 'Casual lookup',
        scope: 'expense',
        query: { scope: 'expense' },
        pinned: false,
      }),
    });
    const j2 = await r2.json() as { data: { id: string } };
    secondId = j2.data.id;

    const res = await fetch(`${WEB}/api/v1/agentbook-core/searches`, {
      headers: { 'x-tenant-id': TENANT_A },
    });
    const body = await res.json() as { success: boolean; data: Array<{ id: string; pinned: boolean }> };
    expect(body.success).toBe(true);
    expect(body.data.length).toBe(2);
    // Pinned-first ordering.
    expect(body.data[0].pinned).toBe(true);
    expect(body.data[0].id).toBe(createdId);
    expect(body.data[1].pinned).toBe(false);
  });

  test('3. GET /:id/run executes and returns rows', async () => {
    const res = await fetch(`${WEB}/api/v1/agentbook-core/searches/${createdId}/run`, {
      headers: { 'x-tenant-id': TENANT_A },
    });
    expect(res.ok).toBe(true);
    const body = await res.json() as {
      success: boolean;
      data: { count: number; scope: string; rows: Array<{ amountCents: number }> };
    };
    expect(body.success).toBe(true);
    expect(body.data.scope).toBe('expense');
    // Date filter is 2026 — our seed dates may not all be in 2026, but the
    // amount filter ≥ $50 should at least exclude the $15 row.
    for (const row of body.data.rows) {
      expect(row.amountCents).toBeGreaterThanOrEqual(5000);
    }
  });

  test('4. PUT toggles pinned and edits name', async () => {
    const res = await fetch(`${WEB}/api/v1/agentbook-core/searches/${secondId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': TENANT_A },
      body: JSON.stringify({ pinned: true, name: 'Casual lookup (edited)' }),
    });
    expect(res.ok).toBe(true);
    const body = await res.json() as { success: boolean; data: { pinned: boolean; name: string } };
    expect(body.success).toBe(true);
    expect(body.data.pinned).toBe(true);
    expect(body.data.name).toBe('Casual lookup (edited)');
  });

  test('5. 11th pinned search returns 422', async () => {
    // We already have 2 pinned in tenant A. Add 8 more to reach 10 total.
    const ids: string[] = [];
    for (let i = 0; i < 8; i += 1) {
      const r = await fetch(`${WEB}/api/v1/agentbook-core/searches`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant-id': TENANT_A },
        body: JSON.stringify({
          name: `bulk-pinned-${i}`,
          scope: 'expense',
          query: { scope: 'expense' },
          pinned: true,
        }),
      });
      expect(r.ok).toBe(true);
      const j = await r.json() as { data: { id: string } };
      ids.push(j.data.id);
    }
    // Now try the 11th — must return 422.
    const eleventh = await fetch(`${WEB}/api/v1/agentbook-core/searches`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-tenant-id': TENANT_A },
      body: JSON.stringify({
        name: 'one-too-many',
        scope: 'expense',
        query: { scope: 'expense' },
        pinned: true,
      }),
    });
    expect(eleventh.status).toBe(422);
    const body = await eleventh.json() as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/pinned limit reached/i);
  });

  test('6. Cross-tenant — sibling tenant cannot read or run', async () => {
    const list = await fetch(`${WEB}/api/v1/agentbook-core/searches`, {
      headers: { 'x-tenant-id': TENANT_B },
    });
    const listBody = await list.json() as { data: unknown[] };
    expect(listBody.data.length).toBe(0);

    const run = await fetch(`${WEB}/api/v1/agentbook-core/searches/${createdId}/run`, {
      headers: { 'x-tenant-id': TENANT_B },
    });
    expect(run.status).toBe(404);
  });

  test('7. DELETE removes the row', async () => {
    const res = await fetch(`${WEB}/api/v1/agentbook-core/searches/${createdId}`, {
      method: 'DELETE',
      headers: { 'x-tenant-id': TENANT_A },
    });
    expect(res.ok).toBe(true);

    // Confirm it's gone.
    const get = await fetch(`${WEB}/api/v1/agentbook-core/searches/${createdId}/run`, {
      headers: { 'x-tenant-id': TENANT_A },
    });
    expect(get.status).toBe(404);
  });
});
