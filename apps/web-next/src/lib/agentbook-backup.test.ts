/**
 * Tests for the daily backup helper (PR 24).
 *
 * `buildAndUploadBackup` walks every tenant-scoped business entity
 * (expenses, invoices, clients, mileage, vendors, accounts), serialises
 * each to a CSV, bundles them in a single ZIP via JSZip, uploads via
 * `uploadBlob`, and writes a `AbBackup` row.
 *
 * Pinned guarantees:
 *   1. ZIP contains a CSV file per entity (with header row), even when
 *      that table is empty for the tenant.
 *   2. Tenant scoping — only the tenant's rows make it into the bundle.
 *   3. `AbBackup` row is written with the returned blobUrl + sizeBytes.
 *   4. `BackupResult` returns the correct entityCount summed across tables.
 *
 * Pure unit-style: prisma + the blob uploader are mocked at the module
 * boundary so this never touches a real DB or Vercel Blob.
 */

import { describe, expect, it, vi, beforeEach } from 'vitest';
import JSZip from 'jszip';

vi.mock('server-only', () => ({}));

vi.mock('@naap/database', () => ({
  prisma: {
    abExpense: { findMany: vi.fn() },
    abInvoice: { findMany: vi.fn() },
    abClient: { findMany: vi.fn() },
    abMileageEntry: { findMany: vi.fn() },
    abVendor: { findMany: vi.fn() },
    abAccount: { findMany: vi.fn() },
    abBackup: { create: vi.fn() },
  },
}));

vi.mock('./agentbook-blob', () => ({
  uploadBlob: vi.fn(),
}));

import { prisma as db } from '@naap/database';
import { uploadBlob } from './agentbook-blob';
import { buildAndUploadBackup } from './agentbook-backup';

const mockedDb = db as unknown as {
  abExpense: { findMany: ReturnType<typeof vi.fn> };
  abInvoice: { findMany: ReturnType<typeof vi.fn> };
  abClient: { findMany: ReturnType<typeof vi.fn> };
  abMileageEntry: { findMany: ReturnType<typeof vi.fn> };
  abVendor: { findMany: ReturnType<typeof vi.fn> };
  abAccount: { findMany: ReturnType<typeof vi.fn> };
  abBackup: { create: ReturnType<typeof vi.fn> };
};
const mockedUpload = uploadBlob as unknown as ReturnType<typeof vi.fn>;

const TENANT_A = 'tenant-A';
const TENANT_B = 'tenant-B';

function setEmptyTables(): void {
  mockedDb.abExpense.findMany.mockResolvedValue([]);
  mockedDb.abInvoice.findMany.mockResolvedValue([]);
  mockedDb.abClient.findMany.mockResolvedValue([]);
  mockedDb.abMileageEntry.findMany.mockResolvedValue([]);
  mockedDb.abVendor.findMany.mockResolvedValue([]);
  mockedDb.abAccount.findMany.mockResolvedValue([]);
}

beforeEach(() => {
  mockedDb.abExpense.findMany.mockReset();
  mockedDb.abInvoice.findMany.mockReset();
  mockedDb.abClient.findMany.mockReset();
  mockedDb.abMileageEntry.findMany.mockReset();
  mockedDb.abVendor.findMany.mockReset();
  mockedDb.abAccount.findMany.mockReset();
  mockedDb.abBackup.create.mockReset();
  mockedUpload.mockReset();
  mockedUpload.mockResolvedValue({
    url: 'https://example.vercel-storage.com/backup.zip',
    size: 1234,
  });
  mockedDb.abBackup.create.mockResolvedValue({ id: 'bk-1' });
});

describe('buildAndUploadBackup', () => {
  it('produces a ZIP with one CSV per table, even when every table is empty', async () => {
    setEmptyTables();

    await buildAndUploadBackup(TENANT_A);

    expect(mockedUpload).toHaveBeenCalledTimes(1);
    const [filename, buf, contentType] = mockedUpload.mock.calls[0];
    expect(filename).toContain(`backup/${TENANT_A}/`);
    expect(filename).toMatch(/\.zip$/);
    expect(contentType).toBe('application/zip');

    const zip = await JSZip.loadAsync(buf as Buffer);
    const names = Object.keys(zip.files).sort();
    expect(names).toEqual([
      'accounts.csv',
      'clients.csv',
      'expenses.csv',
      'invoices.csv',
      'mileage.csv',
      'vendors.csv',
    ]);

    // Every CSV ships with a header row even when empty — accountants
    // expect the column names to exist in a "no data this period"
    // backup so they can spot a *missing* column vs an empty table.
    for (const name of names) {
      const file = zip.file(name);
      expect(file).not.toBeNull();
      const text = await file!.async('string');
      const firstLine = text.split('\n')[0];
      expect(firstLine.length).toBeGreaterThan(0);
      expect(firstLine).toContain(',');
    }
  });

  it('scopes every Prisma findMany to the supplied tenantId', async () => {
    setEmptyTables();

    await buildAndUploadBackup(TENANT_A);

    for (const t of [
      mockedDb.abExpense,
      mockedDb.abInvoice,
      mockedDb.abClient,
      mockedDb.abMileageEntry,
      mockedDb.abVendor,
      mockedDb.abAccount,
    ]) {
      expect(t.findMany).toHaveBeenCalledTimes(1);
      const arg = t.findMany.mock.calls[0][0];
      expect(arg).toBeDefined();
      expect(arg.where).toEqual({ tenantId: TENANT_A });
    }

    // Sanity-check: a sibling tenant invocation makes a fresh, scoped query.
    setEmptyTables();
    await buildAndUploadBackup(TENANT_B);
    const args = mockedDb.abExpense.findMany.mock.calls.at(-1)![0];
    expect(args.where.tenantId).toBe(TENANT_B);
  });

  it('writes an AbBackup row with the upload URL + size', async () => {
    setEmptyTables();
    mockedUpload.mockResolvedValueOnce({
      url: 'https://example.vercel-storage.com/backup-A.zip',
      size: 999,
    });

    const result = await buildAndUploadBackup(TENANT_A);

    expect(result.url).toBe('https://example.vercel-storage.com/backup-A.zip');
    expect(result.sizeBytes).toBeGreaterThan(0);

    expect(mockedDb.abBackup.create).toHaveBeenCalledTimes(1);
    const createArgs = mockedDb.abBackup.create.mock.calls[0][0];
    expect(createArgs.data.tenantId).toBe(TENANT_A);
    expect(createArgs.data.blobUrl).toBe(
      'https://example.vercel-storage.com/backup-A.zip',
    );
    expect(createArgs.data.sizeBytes).toBe(result.sizeBytes);
    expect(typeof createArgs.data.sizeBytes).toBe('number');
  });

  it('reports entityCount summed across every table', async () => {
    mockedDb.abExpense.findMany.mockResolvedValue([
      {
        id: 'e1',
        date: new Date('2026-04-10'),
        amountCents: 1234,
        currency: 'USD',
        description: 'Lunch',
        vendorId: null,
        categoryId: null,
        isPersonal: false,
        status: 'confirmed',
      },
      {
        id: 'e2',
        date: new Date('2026-04-11'),
        amountCents: 5678,
        currency: 'USD',
        description: 'Office, supplies', // comma → CSV escape
        vendorId: null,
        categoryId: null,
        isPersonal: false,
        status: 'confirmed',
      },
    ]);
    mockedDb.abInvoice.findMany.mockResolvedValue([
      {
        id: 'i1',
        number: 'INV-2026-0001',
        clientId: 'c1',
        amountCents: 100000,
        currency: 'USD',
        issuedDate: new Date('2026-04-01'),
        dueDate: new Date('2026-04-30'),
        status: 'sent',
      },
    ]);
    mockedDb.abClient.findMany.mockResolvedValue([
      { id: 'c1', name: 'Acme', email: 'pay@acme.example', defaultTerms: 'net-30' },
    ]);
    mockedDb.abMileageEntry.findMany.mockResolvedValue([]);
    mockedDb.abVendor.findMany.mockResolvedValue([
      { id: 'v1', name: 'Coffee Shop', normalizedName: 'coffee shop' },
    ]);
    mockedDb.abAccount.findMany.mockResolvedValue([]);

    const result = await buildAndUploadBackup(TENANT_A);

    expect(result.entityCount).toBe(2 + 1 + 1 + 0 + 1 + 0);

    // Confirm the expense rows actually serialised (header + 2 data rows).
    const [, buf] = mockedUpload.mock.calls[0];
    const zip = await JSZip.loadAsync(buf as Buffer);
    const expensesCsv = await zip.file('expenses.csv')!.async('string');
    const lines = expensesCsv.trim().split('\n');
    expect(lines.length).toBe(3); // header + 2
    // The comma-containing description must be RFC-4180 quoted so it
    // doesn't bleed into a neighbouring column when an accountant opens
    // the file in Excel / Sheets.
    expect(expensesCsv).toContain('"Office, supplies"');
  });
});
