/**
 * Year-end tax package orchestrator (PR 5).
 *
 * Maya types "give me my 2025 tax package" and the bot returns a PDF +
 * CSV bundle ready for her accountant. This file owns the pure data
 * assembly (`gatherPackageData`) plus the orchestration that persists
 * the artifacts to Vercel Blob and writes the row in `AbTaxPackage`.
 *
 * Layered design:
 *   gatherPackageData ── pure DB read + summarisation (testable)
 *   ↓
 *   renderPackagePdf  ── @react-pdf/renderer (lib: agentbook-tax-pdf)
 *   renderPnlCsv etc. ── string serialisers (lib: agentbook-tax-csv)
 *   buildReceiptsZip  ── jszip + fetch (lib: agentbook-tax-receipts-zip)
 *   ↓
 *   generatePackage   ── uploads → upserts AbTaxPackage row → returns ids
 *
 * Idempotency:
 *   The DB has `unique(tenantId, year, jurisdiction)`. Re-calling
 *   `generatePackage` for the same triple overwrites the artifacts
 *   referenced by that row. Same input → same output; older blob URLs
 *   become orphans (reaped by Vercel's TTL or the storage cleaner).
 *
 * Privacy:
 *   The gather step intentionally selects only the fields needed for
 *   the package — never `passwordHash`, never `accessTokenEnc`, never
 *   `apiKey`. CSV / PDF assertions in the test suite catch regressions.
 */

import 'server-only';
import { prisma as db } from '@naap/database';

// ─── Types ────────────────────────────────────────────────────────────────

export interface PackageInput {
  tenantId: string;
  year: number;
  jurisdiction: 'us' | 'ca';
}

export interface MileageRow {
  id: string;
  date: Date;
  miles: number;
  unit: 'mi' | 'km';
  purpose: string;
  deductibleAmountCents: number;
}

export interface PackageData {
  pnlByLine: Record<string, number>;
  mileage: {
    totalUnit: number;
    totalDeductibleCents: number;
    entries: MileageRow[];
  };
  ar: {
    totalCents: number;
    oldestDays: number;
    agingBuckets: Record<string, number>;
  };
  deductions: {
    byCategory: Record<string, number>;
    totalCents: number;
  };
  expenseCount: number;
  /**
   * Half-open `[start, end)` calendar-year boundary in UTC. `start` is
   * Jan 1 of `year` 00:00:00 UTC; `end` is Jan 1 of `year+1` 00:00:00
   * UTC (exclusive). All readers — PDF, CSV, AR snapshot — must treat
   * this as exclusive on the right and never decrement by 1ms.
   */
  period: { start: Date; end: Date };
  jurisdiction: 'us' | 'ca';
}

/**
 * Categorised failure codes for the AbTaxPackage.errorMsg column. We
 * never persist a raw exception string from the orchestrator — that
 * could leak server internals (file paths, stack frames, env names)
 * back to the client. Instead the catch block tags the failure with
 * the phase that crashed, and the client renders a generic message.
 */
export type TaxPackageFailureCode =
  | 'gather_data_failed'
  | 'pdf_render_failed'
  | 'csv_render_failed'
  | 'blob_upload_failed'
  | 'receipts_zip_failed'
  | 'unknown_failure';

export interface GenerateResult {
  packageId: string;
  pdfUrl: string;
  receiptsZipUrl?: string;
  csvUrls: { pnl: string; mileage: string; deductions: string };
  summary: {
    expenseCount: number;
    deductionsCents: number;
    mileageDeductionCents: number;
    arTotalCents: number;
    pnlByLine: Record<string, number>;
    period: { start: string; end: string };
  };
}

// ─── Tax-line mapping ──────────────────────────────────────────────────────

/**
 * Map an account (name + optional explicit `taxCategory`) into the
 * canonical line label used on the tax form for the given jurisdiction.
 *
 *   • If `taxCategory` is non-null on AbAccount, it wins. The chart of
 *     accounts seed already pre-tags accounts with the Schedule C line
 *     they belong to — that's authoritative.
 *   • Else fall back to the name-based mapping below. Names are matched
 *     case-insensitively against well-known buckets; anything else lands
 *     in the catch-all "Other expenses" line (Sched C 27a / T2125 9270).
 *
 * Returns a HUMAN-READABLE STRING that goes straight into the PDF and
 * CSV — no further translation needed downstream.
 */
export function taxLineFor(
  jurisdiction: 'us' | 'ca',
  accountType: string | null,
  name: string,
  taxCategory: string | null,
): string {
  if (taxCategory && taxCategory.trim()) return taxCategory.trim();

  // Only expense accounts roll up to Schedule C / T2125 expense lines.
  // Revenue lines are handled separately (gross receipts), and other
  // account types shouldn't appear in the package.
  if (accountType && accountType !== 'expense') {
    return jurisdiction === 'ca' ? 'T2125 — Other (non-expense)' : 'Schedule C — Other (non-expense)';
  }

  const n = (name || '').toLowerCase();

  if (jurisdiction === 'ca') {
    // CRA T2125 part 5 expense boxes (line numbers, not box codes — Maya
    // and her accountant both read these as "T2125 line 8523" etc.).
    if (/advert|market/.test(n)) return 'T2125 Line 8521 - Advertising';
    if (/meal|entertain/.test(n)) return 'T2125 Line 8523 - Meals & entertainment';
    if (/insurance/.test(n)) return 'T2125 Line 8690 - Insurance';
    if (/interest/.test(n)) return 'T2125 Line 8710 - Interest';
    if (/office/.test(n)) return 'T2125 Line 8810 - Office expenses';
    if (/supply|supplies/.test(n)) return 'T2125 Line 8811 - Supplies';
    if (/legal|professional|account/.test(n)) return 'T2125 Line 8860 - Professional fees';
    if (/rent/.test(n)) return 'T2125 Line 8910 - Rent';
    if (/repair|maintenance/.test(n)) return 'T2125 Line 8960 - Repairs';
    if (/salary|wage|payroll/.test(n)) return 'T2125 Line 9060 - Salaries & wages';
    if (/travel/.test(n)) return 'T2125 Line 9200 - Travel';
    if (/utility|util|phone|internet/.test(n)) return 'T2125 Line 9220 - Utilities';
    if (/fuel|car|truck|vehicle|mileage|auto/.test(n)) return 'T2125 Line 9281 - Motor vehicle';
    return 'T2125 Line 9270 - Other expenses';
  }

  // US Schedule C (lines 8 through 27a, the freelancer's bread-and-butter).
  if (/advert|market/.test(n)) return 'Schedule C Line 8 - Advertising';
  if (/fuel|car|truck|vehicle|mileage|auto/.test(n)) return 'Schedule C Line 9 - Car & truck';
  if (/legal|professional|account/.test(n)) return 'Schedule C Line 17 - Legal & professional';
  if (/office/.test(n)) return 'Schedule C Line 18 - Office expense';
  if (/rent/.test(n)) return 'Schedule C Line 20b - Rent';
  if (/repair|maintenance/.test(n)) return 'Schedule C Line 21 - Repairs';
  if (/supply|supplies/.test(n)) return 'Schedule C Line 22 - Supplies';
  if (/tax.*licen|licen/.test(n)) return 'Schedule C Line 23 - Taxes & licenses';
  if (/travel/.test(n)) return 'Schedule C Line 24a - Travel';
  if (/meal|entertain/.test(n)) return 'Schedule C Line 24b - Meals';
  if (/utility|util|phone|internet/.test(n)) return 'Schedule C Line 25 - Utilities';
  if (/wage|salary|payroll/.test(n)) return 'Schedule C Line 26 - Wages';
  if (/insurance/.test(n)) return 'Schedule C Line 15 - Insurance';
  if (/interest/.test(n)) return 'Schedule C Line 16 - Interest';
  if (/depreciation/.test(n)) return 'Schedule C Line 13 - Depreciation';

  return 'Schedule C Line 27a - Other expenses';
}

// ─── AR aging helper ───────────────────────────────────────────────────────

interface InvoiceForAr {
  amountCents: number;
  dueDate: Date;
  status: string;
  payments: { amountCents: number }[];
}

function buildArSnapshot(invoices: InvoiceForAr[], now: Date): PackageData['ar'] {
  const buckets: Record<string, number> = { current: 0, '1-30': 0, '31-60': 0, '61-90': 0, '90+': 0 };
  let oldest = 0;
  let total = 0;
  for (const inv of invoices) {
    const paid = inv.payments.reduce((s, p) => s + p.amountCents, 0);
    const balance = inv.amountCents - paid;
    if (balance <= 0) continue;
    const days = Math.max(0, Math.floor((now.getTime() - inv.dueDate.getTime()) / 86_400_000));
    if (days > oldest) oldest = days;
    const bucket =
      days <= 0 ? 'current' :
      days <= 30 ? '1-30' :
      days <= 60 ? '31-60' :
      days <= 90 ? '61-90' : '90+';
    buckets[bucket] = (buckets[bucket] || 0) + balance;
    total += balance;
  }
  return { totalCents: total, oldestDays: oldest, agingBuckets: buckets };
}

// ─── Pure data assembly ────────────────────────────────────────────────────

/**
 * Read everything the package needs from the DB and return a flat,
 * jurisdiction-tagged shape. Pure (no I/O beyond the read), so the unit
 * tests mock `@naap/database` and exercise the mapping directly.
 *
 * Period boundary: half-open `[Jan 1 year, Jan 1 year+1)` in UTC. The
 * AR snapshot uses the same `end` as its "as of" cutoff so the
 * boundary is consistent across all sections; readers should treat
 * `end` as exclusive on the right.
 *
 * We don't honour fiscal-year-start because freelancer Schedule C /
 * T2125 packages are filed on calendar year regardless of the
 * tenant's bookkeeping policy.
 */
export async function gatherPackageData(input: PackageInput): Promise<PackageData> {
  const { tenantId, year, jurisdiction } = input;

  const start = new Date(Date.UTC(year, 0, 1));
  const end = new Date(Date.UTC(year + 1, 0, 1));

  // Load the chart of accounts so we can map expense rows → tax lines.
  // Selecting only what we need keeps the payload small AND gives us a
  // privacy guarantee at the type level (no `passwordHash` etc. exists
  // on AbAccount, but the explicit select keeps future fields out of
  // the PDF / CSV by default).
  const accounts = await db.abAccount.findMany({
    where: { tenantId, accountType: 'expense', isActive: true },
    select: { id: true, code: true, name: true, accountType: true, taxCategory: true },
  });
  const accountById = new Map<string, typeof accounts[number]>();
  for (const a of accounts) accountById.set(a.id, a);

  // Confirmed expenses only — drafts and rejects don't belong on the
  // tax return. `isPersonal=false` keeps personal spending out of
  // the deduction roll-up.
  //
  // Soft-delete (PR 26): include rows that are live (deletedAt IS NULL)
  // OR that were soft-deleted *after* the close of the tax year. A row
  // deleted on Feb 3 of the following year still belonged to the books
  // at year-end and must remain on the year's filing.
  const expenses = await db.abExpense.findMany({
    where: {
      tenantId,
      isPersonal: false,
      status: 'confirmed',
      date: { gte: start, lt: end },
      OR: [{ deletedAt: null }, { deletedAt: { gt: end } }],
    },
    select: {
      id: true,
      amountCents: true,
      date: true,
      categoryId: true,
      receiptUrl: true,
      description: true,
      vendor: { select: { name: true } },
    },
    orderBy: { date: 'asc' },
  });

  const pnlByLine: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  let deductionsTotal = 0;

  for (const e of expenses) {
    const acct = e.categoryId ? accountById.get(e.categoryId) : null;
    if (e.categoryId && !acct) {
      // Stale category — the expense points at an account we couldn't
      // load (deleted, deactivated, or wrong tenant). We still bucket
      // it under "expense" so it lands in a sensible "Other" line, but
      // surface the data-quality issue so it can be cleaned up.
      console.warn(
        `[tax-package] expense ${e.id} has stale category ${e.categoryId} (tenant=${tenantId})`,
      );
    }
    const taxLine = taxLineFor(
      jurisdiction,
      acct?.accountType || 'expense',
      acct?.name || 'Uncategorised',
      acct?.taxCategory || null,
    );
    pnlByLine[taxLine] = (pnlByLine[taxLine] || 0) + e.amountCents;
    byCategory[taxLine] = (byCategory[taxLine] || 0) + e.amountCents;
    deductionsTotal += e.amountCents;
  }

  // Mileage YTD — pulled from PR 4. We surface the per-trip rows so the
  // CSV section has detail; the totals get rolled into the deduction
  // headline on the PDF.
  const mileageEntries = await db.abMileageEntry.findMany({
    where: {
      tenantId,
      date: { gte: start, lt: end },
      // PR 26: keep rows soft-deleted after year-end on the filing.
      OR: [{ deletedAt: null }, { deletedAt: { gt: end } }],
    },
    select: { id: true, date: true, miles: true, unit: true, purpose: true, deductibleAmountCents: true },
    orderBy: { date: 'asc' },
  });
  let totalUnit = 0;
  let mileageDeductible = 0;
  const mileageRows: MileageRow[] = mileageEntries.map((m) => {
    totalUnit += m.miles;
    mileageDeductible += m.deductibleAmountCents;
    return {
      id: m.id,
      date: m.date,
      miles: m.miles,
      unit: (m.unit === 'km' ? 'km' : 'mi') as 'mi' | 'km',
      purpose: m.purpose,
      deductibleAmountCents: m.deductibleAmountCents,
    };
  });

  // AR snapshot — invoices still owed at the package generation moment,
  // including aging buckets so the accountant can see the AR profile.
  // Use `end` (exclusive boundary, Jan 1 next year 00:00 UTC) as the
  // "as of" timestamp so the AR cutoff matches the expense window.
  const invoices = await db.abInvoice.findMany({
    where: {
      tenantId,
      status: { in: ['sent', 'viewed', 'overdue'] },
      // PR 26: AR snapshot also keeps invoices that were soft-deleted
      // after year-end — they were still on the books at the cutoff.
      OR: [{ deletedAt: null }, { deletedAt: { gt: end } }],
    },
    select: {
      amountCents: true,
      dueDate: true,
      status: true,
      payments: { select: { amountCents: true } },
    },
  });
  const ar = buildArSnapshot(invoices, end);

  return {
    pnlByLine,
    mileage: {
      totalUnit,
      totalDeductibleCents: mileageDeductible,
      entries: mileageRows,
    },
    ar,
    deductions: {
      byCategory,
      totalCents: deductionsTotal,
    },
    expenseCount: expenses.length,
    period: { start, end },
    jurisdiction,
  };
}

// ─── Orchestrator: persist + upload + write row ────────────────────────────

/**
 * Generate (or regenerate) the tax package. Writes one row in
 * `AbTaxPackage` keyed by `(tenantId, year, jurisdiction)`, uploads the
 * PDF + per-section CSVs + receipts ZIP to Vercel Blob, and returns the
 * blob URLs alongside the row's id.
 *
 * Idempotency via the unique constraint: rerunning produces a fresh set
 * of artifacts but reuses the same row, overwriting `pdfUrl`,
 * `receiptsZipUrl`, `csvUrls`, and `summary`. Status flips through
 * pending → ready (or → failed with `errorMsg`).
 *
 * The route handler is responsible for awaiting this synchronously
 * (V1 — within the 60-second function ceiling). When we outgrow that,
 * the same orchestrator can be invoked from a background queue without
 * modification.
 */
export async function generatePackage(input: PackageInput): Promise<GenerateResult> {
  const { tenantId, year, jurisdiction } = input;

  // Upsert the row with status='pending' so a concurrent caller never
  // creates a duplicate (the unique constraint enforces it). Subsequent
  // updates set status='ready' once the artifacts land in blob.
  // Capture the prior URLs first so we can delete the orphan blobs
  // after a successful overwrite. Deletion happens AFTER the new row
  // commits — if the regen fails, the prior package stays usable.
  const prior = await db.abTaxPackage.findUnique({
    where: { tenantId_year_jurisdiction: { tenantId, year, jurisdiction } },
    select: { pdfUrl: true, receiptsZipUrl: true, csvUrls: true },
  });
  const pkg = await db.abTaxPackage.upsert({
    where: { tenantId_year_jurisdiction: { tenantId, year, jurisdiction } },
    update: { status: 'pending', errorMsg: null },
    create: {
      tenantId,
      year,
      jurisdiction,
      status: 'pending',
      summary: {},
    },
    select: { id: true },
  });

  // Track the failure phase so the catch block can persist a stable
  // category code instead of a raw exception string. See the
  // `TaxPackageFailureCode` doc above.
  let failurePhase: TaxPackageFailureCode = 'unknown_failure';

  try {
    failurePhase = 'gather_data_failed';
    const data = await gatherPackageData(input);

    // Lazy-load the heavy modules so unit tests that only exercise
    // `gatherPackageData` don't pay the @react-pdf cost.
    const [{ renderPackagePdf }, csvMod, zipMod, blobMod] = await Promise.all([
      import('./agentbook-tax-pdf'),
      import('./agentbook-tax-csv'),
      import('./agentbook-tax-receipts-zip'),
      import('./agentbook-blob'),
    ]);
    const { renderPnlCsv, renderMileageCsv, renderDeductionsCsv } = csvMod;
    const { buildReceiptsZip } = zipMod;
    const { uploadBlob } = blobMod;

    failurePhase = 'pdf_render_failed';
    const pdfBuf = await renderPackagePdf(data);

    failurePhase = 'csv_render_failed';
    const pnlCsv = renderPnlCsv(data);
    const mileageCsv = renderMileageCsv(data);
    const deductionsCsv = renderDeductionsCsv(data);

    failurePhase = 'blob_upload_failed';
    const namePrefix = `tax-package/${tenantId}/${year}/${jurisdiction}`;
    const [pdfUp, pnlUp, mileageUp, dedUp] = await Promise.all([
      uploadBlob(`${namePrefix}/package.pdf`, pdfBuf, 'application/pdf'),
      uploadBlob(`${namePrefix}/pnl.csv`, Buffer.from(pnlCsv, 'utf8'), 'text/csv'),
      uploadBlob(`${namePrefix}/mileage.csv`, Buffer.from(mileageCsv, 'utf8'), 'text/csv'),
      uploadBlob(`${namePrefix}/deductions.csv`, Buffer.from(deductionsCsv, 'utf8'), 'text/csv'),
    ]);

    let receiptsZipUrl: string | undefined;
    try {
      const zipBuf = await buildReceiptsZip(tenantId, year);
      if (zipBuf) {
        const zipUp = await uploadBlob(`${namePrefix}/receipts.zip`, zipBuf, 'application/zip');
        receiptsZipUrl = zipUp.url;
      }
    } catch (err) {
      // The receipts ZIP is best-effort. The PDF is the primary artifact;
      // a receipts-fetch failure shouldn't block the package.
      console.warn('[tax-package] receipts ZIP failed:', err);
    }

    const summary = {
      expenseCount: data.expenseCount,
      deductionsCents: data.deductions.totalCents,
      mileageDeductionCents: data.mileage.totalDeductibleCents,
      arTotalCents: data.ar.totalCents,
      pnlByLine: data.pnlByLine,
      period: { start: data.period.start.toISOString(), end: data.period.end.toISOString() },
    };

    const csvUrls = { pnl: pnlUp.url, mileage: mileageUp.url, deductions: dedUp.url };

    await db.abTaxPackage.update({
      where: { id: pkg.id },
      data: {
        pdfUrl: pdfUp.url,
        receiptsZipUrl: receiptsZipUrl ?? null,
        csvUrls,
        summary,
        status: 'ready',
        errorMsg: null,
      },
    });

    // After the new artifacts commit, garbage-collect the orphans from
    // any prior run for this same (tenant, year, jurisdiction). Best-
    // effort: a delete failure is logged but not surfaced — a stale
    // orphan in storage is preferable to tearing down the regen flow.
    if (prior) {
      const priorCsvs = (prior.csvUrls && typeof prior.csvUrls === 'object'
        ? Object.values(prior.csvUrls as Record<string, string>)
        : []) as string[];
      const orphans = [prior.pdfUrl, prior.receiptsZipUrl, ...priorCsvs].filter(
        (u): u is string =>
          typeof u === 'string'
          && !!u
          && u !== pdfUp.url
          && u !== receiptsZipUrl
          && !Object.values(csvUrls).includes(u),
      );
      if (orphans.length > 0) {
        const { deleteBlobs } = await import('./agentbook-blob');
        await deleteBlobs(orphans);
      }
    }

    return {
      packageId: pkg.id,
      pdfUrl: pdfUp.url,
      receiptsZipUrl,
      csvUrls,
      summary,
    };
  } catch (err) {
    // Log the full error server-side for ops; persist only the
    // categorised code (never the raw message) so the client never
    // sees server internals.
    console.error(
      `[tax-package] failed phase=${failurePhase} tenant=${tenantId} year=${year}:`,
      err,
    );
    await db.abTaxPackage.update({
      where: { id: pkg.id },
      data: { status: 'failed', errorMsg: failurePhase },
    }).catch(() => {});
    throw err;
  }
}
