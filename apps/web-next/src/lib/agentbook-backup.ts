/**
 * Daily backup helper (PR 24).
 *
 * Builds a per-tenant CSV bundle of every business-critical entity
 * (expenses, invoices, clients, mileage, vendors, accounts), zips it,
 * uploads to Vercel Blob, and records the upload in `AbBackup` so we
 * can surface a "Recent backups" history later and so SLO monitoring
 * can detect backup gaps.
 *
 * Privacy / safety:
 *   - Every Prisma read is scoped to `{ tenantId }`. Cross-tenant
 *     leakage would be a regulatory failure (GDPR / PIPEDA / state
 *     privacy laws), so the test pins this behaviour explicitly.
 *   - Only fields explicitly listed in each `select` block ever land in
 *     the CSV — sensitive fields (accessTokens, passwordHashes, etc)
 *     are not in those select blocks and cannot leak.
 *   - The blob is uploaded under `backup/<tenantId>/<utc-date>.zip` so
 *     a tenant can only ever guess their own URL.
 *
 * Compatibility note: every CSV ships with its header row even when
 * the table is empty. Accountants reading a "no data this period"
 * backup expect to see the column names so they can spot a *missing*
 * column vs. an empty table. Tests pin this contract.
 */

import 'server-only';
import JSZip from 'jszip';
import { prisma as db } from '@naap/database';
import { uploadBlob } from './agentbook-blob';

export interface BackupResult {
  /** Vercel Blob URL of the uploaded ZIP. Public — see helper note. */
  url: string;
  /** Compressed size of the uploaded archive in bytes. */
  sizeBytes: number;
  /** Sum of row counts across all included tables. */
  entityCount: number;
}

/**
 * RFC 4180 quoting + Excel formula-injection prevention. Mirrors the
 * helper in `agentbook-tax-csv.ts` so both year-end packages and daily
 * backups handle vendor names containing commas / leading `=` / quotes
 * the same way. Kept inline rather than re-exported to avoid pulling
 * the @react-pdf-bearing module into the daily cron path.
 */
function csvEscape(value: string): string {
  let v = value;
  if (v.length > 0 && /^[=+\-@\t\r]/.test(v)) {
    v = `'${v}`;
  }
  if (/[",\r\n]/.test(v)) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function row(cells: (string | number | null | undefined)[]): string {
  return cells
    .map((c) => csvEscape(c === null || c === undefined ? '' : String(c)))
    .join(',');
}

function dollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

function isoDate(d: Date | null | undefined): string {
  if (!d) return '';
  return d.toISOString().slice(0, 10);
}

interface ExpenseRow {
  id: string;
  date: Date;
  amountCents: number;
  currency: string;
  description: string | null;
  vendorId: string | null;
  categoryId: string | null;
  isPersonal: boolean;
  status: string;
}

interface InvoiceRow {
  id: string;
  number: string;
  clientId: string;
  amountCents: number;
  currency: string;
  issuedDate: Date;
  dueDate: Date;
  status: string;
}

interface ClientRow {
  id: string;
  name: string;
  email: string | null;
  defaultTerms: string;
}

interface MileageRow {
  id: string;
  date: Date;
  miles: number;
  unit: string;
  purpose: string;
  jurisdiction: string;
  ratePerUnitCents: number;
  deductibleAmountCents: number;
}

interface VendorRow {
  id: string;
  name: string;
  normalizedName: string;
}

interface AccountRow {
  id: string;
  code: string;
  name: string;
  accountType: string;
  taxCategory: string | null;
}

function renderExpensesCsv(rows: ExpenseRow[]): string {
  const out: string[] = [
    row([
      'id',
      'date',
      'amount_usd',
      'currency',
      'description',
      'vendor_id',
      'category_id',
      'is_personal',
      'status',
    ]),
  ];
  for (const r of rows) {
    out.push(
      row([
        r.id,
        isoDate(r.date),
        dollars(r.amountCents),
        r.currency,
        r.description,
        r.vendorId,
        r.categoryId,
        r.isPersonal ? 'true' : 'false',
        r.status,
      ]),
    );
  }
  return out.join('\n') + '\n';
}

function renderInvoicesCsv(rows: InvoiceRow[]): string {
  const out: string[] = [
    row([
      'id',
      'number',
      'client_id',
      'amount_usd',
      'currency',
      'issued_date',
      'due_date',
      'status',
    ]),
  ];
  for (const r of rows) {
    out.push(
      row([
        r.id,
        r.number,
        r.clientId,
        dollars(r.amountCents),
        r.currency,
        isoDate(r.issuedDate),
        isoDate(r.dueDate),
        r.status,
      ]),
    );
  }
  return out.join('\n') + '\n';
}

function renderClientsCsv(rows: ClientRow[]): string {
  const out: string[] = [row(['id', 'name', 'email', 'default_terms'])];
  for (const r of rows) {
    out.push(row([r.id, r.name, r.email, r.defaultTerms]));
  }
  return out.join('\n') + '\n';
}

function renderMileageCsv(rows: MileageRow[]): string {
  const out: string[] = [
    row([
      'id',
      'date',
      'quantity',
      'unit',
      'purpose',
      'jurisdiction',
      'rate_per_unit_usd',
      'deductible_amount_usd',
    ]),
  ];
  for (const r of rows) {
    out.push(
      row([
        r.id,
        isoDate(r.date),
        r.miles.toFixed(2),
        r.unit,
        r.purpose,
        r.jurisdiction,
        dollars(r.ratePerUnitCents),
        dollars(r.deductibleAmountCents),
      ]),
    );
  }
  return out.join('\n') + '\n';
}

function renderVendorsCsv(rows: VendorRow[]): string {
  const out: string[] = [row(['id', 'name', 'normalized_name'])];
  for (const r of rows) {
    out.push(row([r.id, r.name, r.normalizedName]));
  }
  return out.join('\n') + '\n';
}

function renderAccountsCsv(rows: AccountRow[]): string {
  const out: string[] = [
    row(['id', 'code', 'name', 'account_type', 'tax_category']),
  ];
  for (const r of rows) {
    out.push(row([r.id, r.code, r.name, r.accountType, r.taxCategory]));
  }
  return out.join('\n') + '\n';
}

/**
 * Build a tenant-scoped CSV bundle, upload it to Vercel Blob, and
 * persist the resulting `AbBackup` row.
 *
 * Caller-driven concurrency: the daily-backup cron should run this
 * with a small fan-out (≤3) since the blob payloads are bigger than
 * the digest crons and we don't want to thrash blob storage.
 */
export async function buildAndUploadBackup(
  tenantId: string,
): Promise<BackupResult> {
  const where = { tenantId };

  // Read every table in parallel — they're independent, and a bad
  // tenant with thousands of rows will still finish faster than the
  // sequential alternative. Each select is narrow on purpose: only
  // the fields below ever land in the export.
  const [expenses, invoices, clients, mileage, vendors, accounts] =
    await Promise.all([
      db.abExpense.findMany({
        where,
        select: {
          id: true,
          date: true,
          amountCents: true,
          currency: true,
          description: true,
          vendorId: true,
          categoryId: true,
          isPersonal: true,
          status: true,
        },
      }),
      db.abInvoice.findMany({
        where,
        select: {
          id: true,
          number: true,
          clientId: true,
          amountCents: true,
          currency: true,
          issuedDate: true,
          dueDate: true,
          status: true,
        },
      }),
      db.abClient.findMany({
        where,
        select: {
          id: true,
          name: true,
          email: true,
          defaultTerms: true,
        },
      }),
      db.abMileageEntry.findMany({
        where,
        select: {
          id: true,
          date: true,
          miles: true,
          unit: true,
          purpose: true,
          jurisdiction: true,
          ratePerUnitCents: true,
          deductibleAmountCents: true,
        },
      }),
      db.abVendor.findMany({
        where,
        select: { id: true, name: true, normalizedName: true },
      }),
      db.abAccount.findMany({
        where,
        select: {
          id: true,
          code: true,
          name: true,
          accountType: true,
          taxCategory: true,
        },
      }),
    ]);

  const zip = new JSZip();
  zip.file('expenses.csv', renderExpensesCsv(expenses as ExpenseRow[]));
  zip.file('invoices.csv', renderInvoicesCsv(invoices as InvoiceRow[]));
  zip.file('clients.csv', renderClientsCsv(clients as ClientRow[]));
  zip.file('mileage.csv', renderMileageCsv(mileage as MileageRow[]));
  zip.file('vendors.csv', renderVendorsCsv(vendors as VendorRow[]));
  zip.file('accounts.csv', renderAccountsCsv(accounts as AccountRow[]));

  const buf = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE',
    compressionOptions: { level: 6 },
  });

  // Per-tenant URL prefix + UTC-date-stamped filename — prevents
  // collisions when the cron retries within the same day and keeps
  // the URL un-guessable across tenants.
  const dateStamp = new Date().toISOString().slice(0, 10);
  const filename = `backup/${tenantId}/${dateStamp}.zip`;

  const upload = await uploadBlob(filename, buf, 'application/zip', {
    addRandomSuffix: true,
  });

  const sizeBytes = buf.length;
  const entityCount =
    expenses.length +
    invoices.length +
    clients.length +
    mileage.length +
    vendors.length +
    accounts.length;

  await db.abBackup.create({
    data: {
      tenantId,
      blobUrl: upload.url,
      sizeBytes,
    },
  });

  return {
    url: upload.url,
    sizeBytes,
    entityCount,
  };
}
