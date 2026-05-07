/**
 * GET /cpa-portal/[token]/dashboard — token-gated read-only summary.
 *
 * Auth: the token IS the credential. No cookie is read, no session is
 * required. We resolve the token via the LRU-cached helper to avoid
 * hammering the DB when the page polls.
 *
 * Response: cash on hand, AR aging, last 30 days expense breakdown,
 * recent expenses (10), recent invoices (10), open CPA requests. Every
 * Prisma call on this path is `findMany` / `findFirst` — there is no
 * mutation surface here. Any future addition must keep that property.
 *
 * Sensitive fields (passwordHash, accessTokenEnc, apiKey, etc.) never
 * appear because the explicit `select: { ... }` clauses below only
 * pick whitelisted columns. Defense-in-depth: the dashboard never
 * touches User, ABTelegramBot.botToken, or AbBankConnection.accessTokenEnc.
 *
 * 403 when the token is unknown or expired. The CPA's UI shows a
 * "this link has expired — please ask {email} for a new one" page.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAccessByToken } from '@/lib/agentbook-cpa-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface RouteParams {
  params: Promise<{ token: string }>;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

export async function GET(
  _request: NextRequest,
  { params }: RouteParams,
): Promise<NextResponse> {
  try {
    const { token } = await params;
    const access = await resolveAccessByToken(token);
    if (!access) {
      return NextResponse.json(
        { success: false, error: 'invalid or expired token' },
        { status: 403 },
      );
    }

    const tenantId = access.tenantId;
    const today = new Date();

    const [
      assetAccounts,
      arInvoices,
      recentExpenses,
      recentInvoices,
      thirtyDayExpenses,
      openRequests,
      tenantConfig,
    ] = await Promise.all([
      // Cash on hand: sum of asset journal-line balances.
      db.abAccount.findMany({
        where: { tenantId, accountType: 'asset', isActive: true },
        select: {
          id: true,
          name: true,
          code: true,
          journalLines: { select: { debitCents: true, creditCents: true } },
        },
      }),
      // Accounts receivable — every still-open invoice (sent / viewed / overdue).
      db.abInvoice.findMany({
        where: {
          tenantId,
          status: { in: ['sent', 'viewed', 'overdue'] },
        },
        select: {
          id: true,
          number: true,
          amountCents: true,
          dueDate: true,
          issuedDate: true,
          status: true,
          currency: true,
          client: { select: { name: true } },
        },
        orderBy: { dueDate: 'asc' },
        take: 50,
      }),
      // Recent business expenses — most-recent 10 confirmed entries.
      // categoryId is a cross-schema FK (AbAccount lives in core); we
      // pull it without a Prisma `include` and resolve names below.
      db.abExpense.findMany({
        where: { tenantId, isPersonal: false, status: 'confirmed' },
        select: {
          id: true,
          date: true,
          amountCents: true,
          currency: true,
          description: true,
          categoryId: true,
          vendor: { select: { name: true } },
          receiptUrl: true,
        },
        orderBy: { date: 'desc' },
        take: 10,
      }),
      // Recent invoices irrespective of status — last 10 issued.
      db.abInvoice.findMany({
        where: { tenantId },
        select: {
          id: true,
          number: true,
          amountCents: true,
          status: true,
          issuedDate: true,
          dueDate: true,
          currency: true,
          client: { select: { name: true } },
        },
        orderBy: { issuedDate: 'desc' },
        take: 10,
      }),
      // Last 30 days expenses for the category breakdown.
      db.abExpense.findMany({
        where: {
          tenantId,
          isPersonal: false,
          date: { gte: daysAgo(30) },
        },
        select: {
          amountCents: true,
          categoryId: true,
        },
      }),
      // Open CPA requests for this tenant — surfaces follow-ups the
      // CPA already filed and can revisit.
      db.abAccountantRequest.findMany({
        where: { tenantId, status: 'open' },
        select: {
          id: true,
          entityType: true,
          entityId: true,
          message: true,
          status: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      }),
      // Tenant-level metadata. Whitelist: company name, currency,
      // jurisdiction. Never user-table fields.
      db.abTenantConfig.findUnique({
        where: { userId: tenantId },
        select: {
          companyName: true,
          currency: true,
          jurisdiction: true,
        },
      }),
    ]);

    // Resolve category names for the expenses we just pulled. Cross-
    // schema lookup so we keep dashboard data read-only and tenant-
    // scoped. One round trip even if there are 50+ unique categoryIds.
    const allCategoryIds = new Set<string>();
    for (const e of recentExpenses) if (e.categoryId) allCategoryIds.add(e.categoryId);
    for (const e of thirtyDayExpenses) if (e.categoryId) allCategoryIds.add(e.categoryId);
    const categoryRows = allCategoryIds.size
      ? await db.abAccount.findMany({
          where: { tenantId, id: { in: Array.from(allCategoryIds) } },
          select: { id: true, name: true, code: true },
        })
      : [];
    const categoryById = new Map(categoryRows.map((c) => [c.id, c]));

    const cashOnHandCents = assetAccounts.reduce((sum, account) => {
      const bal = account.journalLines.reduce(
        (acc, l) => acc + l.debitCents - l.creditCents,
        0,
      );
      return sum + bal;
    }, 0);

    // AR aging buckets. AbInvoice doesn't carry an explicit balance
    // column — we use amountCents minus posted payments per row to
    // get the open balance. For PR 11 we keep it simple: amountCents
    // on still-open statuses.
    const arBuckets = { current: 0, d1to30: 0, d31to60: 0, d61to90: 0, d90plus: 0 };
    for (const inv of arInvoices) {
      const due = inv.dueDate?.getTime() || today.getTime();
      const daysPast = Math.floor((today.getTime() - due) / 86_400_000);
      const open = inv.amountCents;
      if (daysPast <= 0) arBuckets.current += open;
      else if (daysPast <= 30) arBuckets.d1to30 += open;
      else if (daysPast <= 60) arBuckets.d31to60 += open;
      else if (daysPast <= 90) arBuckets.d61to90 += open;
      else arBuckets.d90plus += open;
    }

    // Last 30 days expense breakdown by category.
    const breakdown = new Map<string, { name: string; code: string; amountCents: number }>();
    for (const e of thirtyDayExpenses) {
      const cat = e.categoryId ? categoryById.get(e.categoryId) : null;
      const key = cat?.id || 'uncategorized';
      const name = cat?.name || 'Uncategorized';
      const code = cat?.code || '';
      const cur = breakdown.get(key) || { name, code, amountCents: 0 };
      cur.amountCents += e.amountCents;
      breakdown.set(key, cur);
    }

    // Hydrate recentExpenses with category labels for the response.
    const recentExpensesOut = recentExpenses.map((e) => {
      const cat = e.categoryId ? categoryById.get(e.categoryId) : null;
      return {
        id: e.id,
        date: e.date,
        amountCents: e.amountCents,
        currency: e.currency,
        description: e.description,
        vendor: e.vendor,
        category: cat ? { name: cat.name, code: cat.code } : null,
        receiptUrl: e.receiptUrl,
      };
    });
    const last30dByCategory = Array.from(breakdown.values()).sort(
      (a, b) => b.amountCents - a.amountCents,
    );
    const last30dTotalCents = last30dByCategory.reduce((s, r) => s + r.amountCents, 0);

    return NextResponse.json({
      success: true,
      data: {
        access: {
          // The CPA's email is OK to echo back — they already know it.
          // Tenant id is needed by the page so client-side fetches can
          // send x-tenant-id back, but role / expiry are mostly for UX.
          email: access.email,
          role: access.role,
          expiresAt: access.expiresAt,
        },
        tenant: tenantConfig
          ? {
              businessName: tenantConfig.companyName,
              currency: tenantConfig.currency,
              jurisdiction: tenantConfig.jurisdiction,
            }
          : null,
        cashOnHandCents,
        arAging: arBuckets,
        arInvoices: arInvoices.slice(0, 25),
        recentExpenses: recentExpensesOut,
        recentInvoices,
        last30dExpenses: {
          totalCents: last30dTotalCents,
          byCategory: last30dByCategory.slice(0, 10),
          startDate: startOfMonth(today),
        },
        openRequests,
        // Helpful flag for the page header — "this link expires in N days".
        daysUntilExpiry: access.expiresAt
          ? Math.max(
              0,
              Math.ceil((access.expiresAt.getTime() - today.getTime()) / 86_400_000),
            )
          : null,
      },
    });
  } catch (err) {
    console.error('[cpa-portal/dashboard] failed:', err);
    // Generic 500 — never leak internal error text to a public endpoint.
    return NextResponse.json(
      { success: false, error: 'internal error' },
      { status: 500 },
    );
  }
}

// Mutation methods are explicitly rejected so a fat-finger Postman or a
// bad caller gets a clear 405 instead of falling through to GET.
export async function POST(): Promise<NextResponse> {
  return NextResponse.json({ success: false, error: 'method not allowed' }, { status: 405 });
}
export async function PUT(): Promise<NextResponse> {
  return NextResponse.json({ success: false, error: 'method not allowed' }, { status: 405 });
}
export async function DELETE(): Promise<NextResponse> {
  return NextResponse.json({ success: false, error: 'method not allowed' }, { status: 405 });
}
export async function PATCH(): Promise<NextResponse> {
  return NextResponse.json({ success: false, error: 'method not allowed' }, { status: 405 });
}
