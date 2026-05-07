/**
 * Unit tests for the audit() helper (PR 10).
 *
 * The audit helper writes a structured AbAuditEvent row for every
 * mutation, with a sparse before/after diff so we don't dump the full
 * row into the audit table. Sensitive fields (passwordHash,
 * accessTokenEnc, apiKey, secret*) are redacted from the diff. The
 * helper is best-effort: a DB failure during audit must NEVER break
 * the underlying mutation, so the helper catches and logs.
 *
 * Cases:
 *   1. create (after only)         → after present, before absent
 *   2. update (before+after diff)  → only changed keys appear
 *   3. delete (before only)        → before present, after absent
 *   4. redaction of sensitive keys → passwordHash etc. stripped
 *   5. no-op when before==after    → no row written
 *   6. invalid input rejected      → no row written, no throw
 *   7. DB failure swallowed        → caller doesn't see the error
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';

vi.mock('server-only', () => ({}));

vi.mock('@naap/database', () => {
  return {
    prisma: {
      abAuditEvent: {
        create: vi.fn(),
      },
    },
  };
});

import { prisma as db } from '@naap/database';
import { audit } from './agentbook-audit';

const mockedDb = db as unknown as {
  abAuditEvent: { create: ReturnType<typeof vi.fn> };
};

beforeEach(() => {
  mockedDb.abAuditEvent.create.mockReset();
  mockedDb.abAuditEvent.create.mockResolvedValue({ id: 'audit-1' });
});

describe('audit()', () => {
  it('writes a row for create (after only, no before)', async () => {
    await audit({
      tenantId: 't1',
      source: 'web',
      action: 'invoice.create',
      entityType: 'AbInvoice',
      entityId: 'inv-1',
      after: { id: 'inv-1', number: 'INV-2026-0001', amountCents: 5000 },
    });

    expect(mockedDb.abAuditEvent.create).toHaveBeenCalledTimes(1);
    const args = mockedDb.abAuditEvent.create.mock.calls[0][0];
    expect(args.data.tenantId).toBe('t1');
    expect(args.data.action).toBe('invoice.create');
    expect(args.data.entityType).toBe('AbInvoice');
    expect(args.data.entityId).toBe('inv-1');
    expect(args.data.before).toBeNull();
    expect(args.data.after).toEqual({
      id: 'inv-1',
      number: 'INV-2026-0001',
      amountCents: 5000,
    });
  });

  it('writes a sparse diff for update — only changed keys', async () => {
    await audit({
      tenantId: 't1',
      source: 'web',
      action: 'expense.update',
      entityType: 'AbExpense',
      entityId: 'exp-1',
      before: {
        id: 'exp-1',
        amountCents: 1000,
        categoryId: 'cat-old',
        description: 'Coffee',
        isPersonal: false,
      },
      after: {
        id: 'exp-1',
        amountCents: 1500,
        categoryId: 'cat-new',
        description: 'Coffee',
        isPersonal: false,
      },
    });

    expect(mockedDb.abAuditEvent.create).toHaveBeenCalledTimes(1);
    const data = mockedDb.abAuditEvent.create.mock.calls[0][0].data;
    // Only the keys that changed should appear in the diff.
    expect(data.before).toEqual({ amountCents: 1000, categoryId: 'cat-old' });
    expect(data.after).toEqual({ amountCents: 1500, categoryId: 'cat-new' });
    // Unchanged keys (description, isPersonal) must not leak through.
    expect(data.before).not.toHaveProperty('description');
    expect(data.after).not.toHaveProperty('description');
  });

  it('writes a row for delete (before only, no after)', async () => {
    await audit({
      tenantId: 't1',
      source: 'web',
      action: 'expense.delete',
      entityType: 'AbExpense',
      entityId: 'exp-1',
      before: { id: 'exp-1', amountCents: 2000, vendor: 'ACME' },
    });

    const data = mockedDb.abAuditEvent.create.mock.calls[0][0].data;
    expect(data.before).toEqual({ id: 'exp-1', amountCents: 2000, vendor: 'ACME' });
    expect(data.after).toBeNull();
  });

  it('redacts sensitive fields (passwordHash, accessTokenEnc, apiKey, secret*)', async () => {
    await audit({
      tenantId: 't1',
      source: 'web',
      action: 'user.update',
      entityType: 'AbUser',
      entityId: 'u1',
      before: {
        email: 'a@b.com',
        // The non-sensitive `email` doesn't change — but `displayName`
        // does, and the sensitive fields should NEVER appear in the
        // diff regardless of whether they changed.
        displayName: 'Old Name',
        passwordHash: 'old-hash',
        accessTokenEnc: 'enc-old',
        apiKey: 'sk-old',
        secretAnswer: 'old-answer',
      },
      after: {
        email: 'a@b.com',
        displayName: 'New Name',
        passwordHash: 'new-hash',
        accessTokenEnc: 'enc-new',
        apiKey: 'sk-new',
        secretAnswer: 'new-answer',
      },
    });

    expect(mockedDb.abAuditEvent.create).toHaveBeenCalledTimes(1);
    const data = mockedDb.abAuditEvent.create.mock.calls[0][0].data;
    // Sensitive keys must not survive into the audit row, even if changed.
    expect(data.before).toEqual({ displayName: 'Old Name' });
    expect(data.after).toEqual({ displayName: 'New Name' });
    expect(data.before).not.toHaveProperty('passwordHash');
    expect(data.before).not.toHaveProperty('accessTokenEnc');
    expect(data.before).not.toHaveProperty('apiKey');
    expect(data.before).not.toHaveProperty('secretAnswer');
    expect(data.after).not.toHaveProperty('passwordHash');
    expect(data.after).not.toHaveProperty('accessTokenEnc');
    expect(data.after).not.toHaveProperty('apiKey');
    expect(data.after).not.toHaveProperty('secretAnswer');
  });

  it('skips the write when before === after (no-op update)', async () => {
    await audit({
      tenantId: 't1',
      source: 'web',
      action: 'expense.update',
      entityType: 'AbExpense',
      entityId: 'exp-1',
      before: { amountCents: 1000, description: 'Coffee' },
      after: { amountCents: 1000, description: 'Coffee' },
    });

    expect(mockedDb.abAuditEvent.create).not.toHaveBeenCalled();
  });

  it('rejects empty / missing required fields without throwing', async () => {
    await expect(
      audit({
        // Empty strings should be treated as missing — helper rejects.
        tenantId: '',
        source: 'web',
        action: '',
        entityType: '',
        entityId: '',
      }),
    ).resolves.toBeUndefined();

    expect(mockedDb.abAuditEvent.create).not.toHaveBeenCalled();
  });

  it('swallows DB errors so the underlying mutation is never broken', async () => {
    mockedDb.abAuditEvent.create.mockRejectedValueOnce(new Error('DB went away'));

    await expect(
      audit({
        tenantId: 't1',
        source: 'web',
        action: 'invoice.create',
        entityType: 'AbInvoice',
        entityId: 'inv-1',
        after: { number: 'INV-2026-0001' },
      }),
    ).resolves.toBeUndefined();

    expect(mockedDb.abAuditEvent.create).toHaveBeenCalledTimes(1);
  });
});
