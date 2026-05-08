/**
 * Saved-search engine (PR 17).
 *
 * Translates a tenant-scoped `SearchQuery` into Prisma `where` clauses
 * for the three queryable entity types and executes the read. Each
 * scope ('expense', 'invoice', 'mileage') maps to one table; 'all'
 * fans out across the three. Every read is hard-capped at 200 rows
 * (per scope when 'all') so a saved search can't accidentally fetch a
 * tenant's entire ledger.
 *
 * The engine is pure read-side — it is invoked by:
 *   • `GET /agentbook-core/searches/[id]/run` (web + bot)
 *   • the SavedSearches page when the user hits "Run inline"
 *
 * Filters are intentionally permissive — every field on `SearchQuery`
 * is optional. An empty query is a valid "list everything" request
 * (subject to the tenant scope and 200-row cap).
 */

import 'server-only';
import { prisma as db } from '@naap/database';

export type SearchScope = 'expense' | 'invoice' | 'mileage' | 'all';

export interface SearchQuery {
  scope: SearchScope;
  text?: string;
  categoryName?: string;
  vendorName?: string;
  amountMinCents?: number;
  amountMaxCents?: number;
  startDate?: string;          // ISO YYYY-MM-DD
  endDate?: string;            // ISO YYYY-MM-DD
  isPersonal?: boolean;
  isDeductible?: boolean;
}

export interface SearchResult {
  scope: SearchScope;
  rows: unknown[];
  count: number;
}

const ROW_CAP = 200;

function rangeFromIso(start?: string, end?: string): { gte?: Date; lte?: Date } | null {
  const out: { gte?: Date; lte?: Date } = {};
  if (start) {
    const d = new Date(start);
    if (!isNaN(d.getTime())) out.gte = d;
  }
  if (end) {
    const d = new Date(end);
    if (!isNaN(d.getTime())) {
      // Inclusive end-of-day so callers can pass plain YYYY-MM-DD.
      d.setUTCHours(23, 59, 59, 999);
      out.lte = d;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

function amountRange(min?: number, max?: number): { gte?: number; lte?: number } | null {
  const out: { gte?: number; lte?: number } = {};
  if (typeof min === 'number' && isFinite(min) && min >= 0) out.gte = min;
  if (typeof max === 'number' && isFinite(max) && max >= 0) out.lte = max;
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Build the Prisma where clause for AbExpense rows. Exported for unit
 * tests so we can verify each filter independently.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildExpenseWhere(tenantId: string, q: SearchQuery): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { tenantId };

  const dr = rangeFromIso(q.startDate, q.endDate);
  if (dr) where.date = dr;

  const ar = amountRange(q.amountMinCents, q.amountMaxCents);
  if (ar) where.amountCents = ar;

  if (typeof q.isPersonal === 'boolean') where.isPersonal = q.isPersonal;
  if (typeof q.isDeductible === 'boolean') where.isDeductible = q.isDeductible;

  if (q.vendorName && q.vendorName.trim()) {
    where.vendor = { name: { contains: q.vendorName.trim(), mode: 'insensitive' } };
  }

  // Fuzzy "category" match — we don't have a JOIN on AbAccount via Prisma's
  // relational filter for AbExpense, so encode as an OR across description,
  // tags, and vendor name. Handles "Meals" → matches "Lunch at X" with tag
  // "meals", or vendor "Doordash Meals". Worst case it widens the result
  // set, which is fine: the user is searching, not auditing.
  if (q.categoryName && q.categoryName.trim()) {
    const t = q.categoryName.trim();
    where.OR = [
      { description: { contains: t, mode: 'insensitive' } },
      { tags: { contains: t, mode: 'insensitive' } },
      { vendor: { name: { contains: t, mode: 'insensitive' } } },
    ];
  }

  // Free-text — applies on top of any structured filters.
  if (q.text && q.text.trim()) {
    const t = q.text.trim();
    const textOr = [
      { description: { contains: t, mode: 'insensitive' } },
      { notes: { contains: t, mode: 'insensitive' } },
      { tags: { contains: t, mode: 'insensitive' } },
    ];
    if (where.OR) {
      // categoryName already wrote OR — combine via AND so both hold.
      where.AND = [{ OR: where.OR }, { OR: textOr }];
      delete where.OR;
    } else {
      where.OR = textOr;
    }
  }

  return where;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildInvoiceWhere(tenantId: string, q: SearchQuery): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { tenantId };

  const dr = rangeFromIso(q.startDate, q.endDate);
  if (dr) where.issuedDate = dr;

  const ar = amountRange(q.amountMinCents, q.amountMaxCents);
  if (ar) where.amountCents = ar;

  if (q.text && q.text.trim()) {
    // Invoice has no description column; match on `number` (e.g. "INV-2026")
    // or fall through to a client-name relational filter.
    const t = q.text.trim();
    where.OR = [
      { number: { contains: t, mode: 'insensitive' } },
      { client: { name: { contains: t, mode: 'insensitive' } } },
    ];
  }

  if (q.categoryName && q.categoryName.trim()) {
    // Invoice "category" is approximated by client name match — invoices
    // don't have a free-text description column, so this is the closest
    // semantic to "category".
    const t = q.categoryName.trim();
    where.client = { name: { contains: t, mode: 'insensitive' } };
  }

  return where;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildMileageWhere(tenantId: string, q: SearchQuery): any {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = { tenantId };

  const dr = rangeFromIso(q.startDate, q.endDate);
  if (dr) where.date = dr;

  if (q.text && q.text.trim()) {
    where.purpose = { contains: q.text.trim(), mode: 'insensitive' };
  }

  return where;
}

/**
 * Run a saved search. Returns the rows, the count, and the scope echo
 * so callers (UI + bot) can render correctly without re-loading the
 * SavedSearch row.
 */
export async function runSavedSearch(
  tenantId: string,
  query: SearchQuery,
): Promise<SearchResult> {
  const scope: SearchScope = query.scope ?? 'expense';

  if (scope === 'expense') {
    const raw = await db.abExpense.findMany({
      where: buildExpenseWhere(tenantId, query),
      orderBy: { date: 'desc' },
      take: ROW_CAP,
    });
    const rows = raw.slice(0, ROW_CAP);
    return { scope, rows, count: rows.length };
  }

  if (scope === 'invoice') {
    const rows = await db.abInvoice.findMany({
      where: buildInvoiceWhere(tenantId, query),
      orderBy: { issuedDate: 'desc' },
      take: ROW_CAP,
    });
    return { scope, rows, count: rows.length };
  }

  if (scope === 'mileage') {
    const rows = await db.abMileageEntry.findMany({
      where: buildMileageWhere(tenantId, query),
      orderBy: { date: 'desc' },
      take: ROW_CAP,
    });
    return { scope, rows, count: rows.length };
  }

  // scope === 'all' — fan out across the three. Each is independently
  // capped at the tier (i.e. up to 200 of each kind) so the user can see
  // every entity surface for "vacations 2026" or similar.
  const [expenses, invoices, mileage] = await Promise.all([
    db.abExpense.findMany({
      where: buildExpenseWhere(tenantId, query),
      orderBy: { date: 'desc' },
      take: ROW_CAP,
    }),
    db.abInvoice.findMany({
      where: buildInvoiceWhere(tenantId, query),
      orderBy: { issuedDate: 'desc' },
      take: ROW_CAP,
    }),
    db.abMileageEntry.findMany({
      where: buildMileageWhere(tenantId, query),
      orderBy: { date: 'desc' },
      take: ROW_CAP,
    }),
  ]);

  const merged = [
    ...expenses.map((r) => ({ kind: 'expense', row: r })),
    ...invoices.map((r) => ({ kind: 'invoice', row: r })),
    ...mileage.map((r) => ({ kind: 'mileage', row: r })),
  ];

  return { scope: 'all', rows: merged, count: merged.length };
}
