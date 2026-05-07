/**
 * /cpa/[token] — public read-only CPA portal page (PR 11).
 *
 * Server-renders the dashboard summary and exposes a "Request more
 * info" form that posts to /cpa-portal/[token]/request. The token in
 * the URL is the entire credential — no cookie auth, no naap session.
 *
 * The page is intentionally minimal (no react-query, no client store):
 * RSC fetches the summary at request time, the form is a tiny client
 * component that POSTs and refreshes. Anything more sophisticated
 * belongs in PR 12+.
 */

import { notFound } from 'next/navigation';
import { resolveAccessByToken } from '@/lib/agentbook-cpa-token';
import { prisma as db } from '@naap/database';
import { CpaRequestForm } from './cpa-request-form';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Token IS the credential and lives in the URL — keep search engines out
// and don't bleed the token through the Referer header on outbound clicks.
export const metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer' as const,
};

interface PageProps {
  params: Promise<{ token: string }>;
}

interface DashboardData {
  access: { email: string; role: string; expiresAt: Date | null };
  tenant: { businessName: string | null; currency: string | null; jurisdiction: string | null } | null;
  cashOnHandCents: number;
  arAging: { current: number; d1to30: number; d31to60: number; d61to90: number; d90plus: number };
  arInvoices: Array<{
    id: string;
    number: string;
    amountCents: number;
    dueDate: Date | null;
    status: string;
    currency: string;
    client: { name: string } | null;
  }>;
  recentExpenses: Array<{
    id: string;
    date: Date;
    amountCents: number;
    currency: string;
    description: string | null;
    vendor: { name: string } | null;
    category: { name: string; code: string } | null;
    receiptUrl: string | null;
  }>;
  recentInvoices: Array<{
    id: string;
    number: string;
    amountCents: number;
    status: string;
    issuedDate: Date | null;
    currency: string;
    client: { name: string } | null;
  }>;
  last30dExpenses: {
    totalCents: number;
    byCategory: Array<{ name: string; code: string; amountCents: number }>;
  };
  openRequests: Array<{
    id: string;
    entityType: string;
    entityId: string | null;
    message: string;
    status: string;
    createdAt: Date;
  }>;
  daysUntilExpiry: number | null;
}

function fmt$(cents: number, currency = 'USD'): string {
  const dollars = cents / 100;
  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency || 'USD',
      maximumFractionDigits: 2,
    }).format(dollars);
  } catch {
    return `$${dollars.toFixed(2)}`;
  }
}

function fmtDate(d: Date | string | null): string {
  if (!d) return '—';
  const dt = typeof d === 'string' ? new Date(d) : d;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(dt);
}

/**
 * RSC-side fetch: call the same Prisma queries the dashboard route
 * uses, but inline. We could fetch() the route handler instead, but
 * that adds a network hop and we already have the access record from
 * resolveAccessByToken.
 */
async function loadDashboard(
  tenantId: string,
  accessEmail: string,
  accessRole: string,
  accessExpiresAt: Date | null,
): Promise<DashboardData | null> {
  const today = new Date();
  const daysAgo = (n: number): Date => {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d;
  };

  const [
    assetAccounts,
    arInvoices,
    recentExpenses,
    recentInvoices,
    thirtyDayExpenses,
    openRequests,
    tenantConfig,
  ] = await Promise.all([
    db.abAccount.findMany({
      where: { tenantId, accountType: 'asset', isActive: true },
      select: { id: true, journalLines: { select: { debitCents: true, creditCents: true } } },
    }),
    db.abInvoice.findMany({
      where: { tenantId, status: { in: ['sent', 'viewed', 'overdue'] } },
      select: {
        id: true,
        number: true,
        amountCents: true,
        dueDate: true,
        status: true,
        currency: true,
        client: { select: { name: true } },
      },
      orderBy: { dueDate: 'asc' },
      take: 25,
    }),
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
    db.abInvoice.findMany({
      where: { tenantId },
      select: {
        id: true,
        number: true,
        amountCents: true,
        status: true,
        issuedDate: true,
        currency: true,
        client: { select: { name: true } },
      },
      orderBy: { issuedDate: 'desc' },
      take: 10,
    }),
    db.abExpense.findMany({
      where: { tenantId, isPersonal: false, date: { gte: daysAgo(30) } },
      select: {
        amountCents: true,
        categoryId: true,
      },
    }),
    db.abAccountantRequest.findMany({
      where: { tenantId, status: 'open' },
      select: { id: true, entityType: true, entityId: true, message: true, status: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 25,
    }),
    db.abTenantConfig.findUnique({
      where: { userId: tenantId },
      select: { companyName: true, currency: true, jurisdiction: true },
    }),
  ]);

  const cashOnHandCents = assetAccounts.reduce((sum, a) => {
    return sum + a.journalLines.reduce((acc, l) => acc + l.debitCents - l.creditCents, 0);
  }, 0);

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

  // Resolve category names for the expense rows we just pulled.
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
  const last30dByCategory = Array.from(breakdown.values()).sort(
    (a, b) => b.amountCents - a.amountCents,
  );
  const last30dTotalCents = last30dByCategory.reduce((s, r) => s + r.amountCents, 0);

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

  return {
    access: {
      email: accessEmail,
      role: accessRole,
      expiresAt: accessExpiresAt,
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
    arInvoices,
    recentExpenses: recentExpensesOut,
    recentInvoices,
    last30dExpenses: { totalCents: last30dTotalCents, byCategory: last30dByCategory.slice(0, 10) },
    openRequests,
    daysUntilExpiry: accessExpiresAt
      ? Math.max(0, Math.ceil((accessExpiresAt.getTime() - today.getTime()) / 86_400_000))
      : null,
  };
}

export default async function CpaPortalPage({ params }: PageProps) {
  const { token } = await params;
  const access = await resolveAccessByToken(token);
  if (!access) notFound();

  const data = await loadDashboard(access.tenantId, access.email, access.role, access.expiresAt);
  if (!data) notFound();

  const currency = data.tenant?.currency || 'USD';

  return (
    <main style={{ maxWidth: '960px', margin: '40px auto', padding: '0 24px', fontFamily: 'system-ui, sans-serif', color: '#111' }}>
      <header style={{ borderBottom: '1px solid #e5e7eb', paddingBottom: '16px', marginBottom: '24px' }}>
        <p style={{ fontSize: '13px', color: '#6b7280', margin: 0 }}>CPA Portal — read-only</p>
        <h1 style={{ fontSize: '28px', margin: '4px 0 0' }}>
          {data.tenant?.businessName || 'Client books'}
        </h1>
        <p style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>
          Signed in as <b>{data.access.email}</b> ({data.access.role})
          {data.daysUntilExpiry !== null && (
            <> · link expires in {data.daysUntilExpiry} day{data.daysUntilExpiry === 1 ? '' : 's'}</>
          )}
        </p>
      </header>

      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', marginBottom: '32px' }}>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px' }}>
          <p style={{ fontSize: '12px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>Cash on hand</p>
          <p style={{ fontSize: '28px', fontWeight: 700, margin: '4px 0 0' }}>
            {fmt$(data.cashOnHandCents, currency)}
          </p>
        </div>
        <div style={{ border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px' }}>
          <p style={{ fontSize: '12px', color: '#6b7280', textTransform: 'uppercase', letterSpacing: '0.05em', margin: 0 }}>Last 30 days expenses</p>
          <p style={{ fontSize: '28px', fontWeight: 700, margin: '4px 0 0' }}>
            {fmt$(data.last30dExpenses.totalCents, currency)}
          </p>
        </div>
      </section>

      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '18px', margin: '0 0 12px' }}>AR aging</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
              <th style={{ padding: '8px 0' }}>Current</th>
              <th>1–30d</th>
              <th>31–60d</th>
              <th>61–90d</th>
              <th>90d+</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td style={{ padding: '8px 0' }}>{fmt$(data.arAging.current, currency)}</td>
              <td>{fmt$(data.arAging.d1to30, currency)}</td>
              <td>{fmt$(data.arAging.d31to60, currency)}</td>
              <td>{fmt$(data.arAging.d61to90, currency)}</td>
              <td>{fmt$(data.arAging.d90plus, currency)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '18px', margin: '0 0 12px' }}>Last 30 days by category</h2>
        {data.last30dExpenses.byCategory.length === 0 ? (
          <p style={{ color: '#6b7280' }}>No expenses recorded.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
            <tbody>
              {data.last30dExpenses.byCategory.map((c) => (
                <tr key={c.code || c.name} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '6px 0' }}>{c.name}</td>
                  <td style={{ textAlign: 'right' }}>{fmt$(c.amountCents, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '18px', margin: '0 0 12px' }}>Recent expenses</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
              <th style={{ padding: '8px 0' }}>Date</th>
              <th>Vendor</th>
              <th>Category</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.recentExpenses.map((e) => (
              <tr key={e.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '6px 0' }}>{fmtDate(e.date)}</td>
                <td>{e.vendor?.name || e.description || '—'}</td>
                <td>{e.category?.name || 'Uncategorized'}</td>
                <td style={{ textAlign: 'right' }}>{fmt$(e.amountCents, e.currency || currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '18px', margin: '0 0 12px' }}>Recent invoices</h2>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
          <thead>
            <tr style={{ textAlign: 'left', borderBottom: '1px solid #e5e7eb' }}>
              <th style={{ padding: '8px 0' }}>Issued</th>
              <th>Number</th>
              <th>Client</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {data.recentInvoices.map((inv) => (
              <tr key={inv.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '6px 0' }}>{fmtDate(inv.issuedDate)}</td>
                <td>{inv.number || '—'}</td>
                <td>{inv.client?.name || '—'}</td>
                <td>{inv.status}</td>
                <td style={{ textAlign: 'right' }}>{fmt$(inv.amountCents, inv.currency || currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {data.openRequests.length > 0 && (
        <section style={{ marginBottom: '32px' }}>
          <h2 style={{ fontSize: '18px', margin: '0 0 12px' }}>Your open follow-ups</h2>
          <ul style={{ paddingLeft: '20px', fontSize: '14px' }}>
            {data.openRequests.map((r) => (
              <li key={r.id} style={{ marginBottom: '6px' }}>
                <span style={{ color: '#6b7280' }}>{fmtDate(r.createdAt)} · {r.entityType}: </span>
                {r.message}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section style={{ marginBottom: '32px' }}>
        <h2 style={{ fontSize: '18px', margin: '0 0 12px' }}>Request more info</h2>
        <CpaRequestForm token={token} />
      </section>
    </main>
  );
}
