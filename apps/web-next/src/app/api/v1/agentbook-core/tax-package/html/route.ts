/**
 * Tax package as printable HTML — same data as /tax-package but
 * rendered to a styled standalone HTML doc the user can save / print.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const yearParam = request.nextUrl.searchParams.get('year');
    const taxYear = yearParam ? parseInt(yearParam, 10) : new Date().getFullYear();
    const config = await db.abTenantConfig.findUnique({ where: { userId: tenantId } });
    const yearStart = new Date(taxYear, 0, 1);
    const yearEnd = new Date(taxYear, 11, 31);

    const revenueAccounts = await db.abAccount.findMany({
      where: { tenantId, accountType: 'revenue' },
      select: { id: true },
    });
    const revLines = await db.abJournalLine.findMany({
      where: {
        accountId: { in: revenueAccounts.map((a) => a.id) },
        entry: { tenantId, date: { gte: yearStart, lte: yearEnd } },
      },
    });
    const gross = revLines.reduce((s, l) => s + l.creditCents, 0);

    const expenseAccounts = await db.abAccount.findMany({
      where: { tenantId, accountType: 'expense' },
    });
    const categories: { category: string; amount: string; cents: number }[] = [];
    let totalExp = 0;
    for (const a of expenseAccounts) {
      const lines = await db.abJournalLine.findMany({
        where: { accountId: a.id, entry: { tenantId, date: { gte: yearStart, lte: yearEnd } } },
      });
      const amount = lines.reduce((s, l) => s + l.debitCents, 0);
      if (amount > 0) {
        categories.push({
          category: a.taxCategory || a.name,
          amount: `$${(amount / 100).toFixed(2)}`,
          cents: amount,
        });
        totalExp += amount;
      }
    }

    const net = gross - totalExp;
    const estimate = await db.abTaxEstimate.findFirst({
      where: { tenantId },
      orderBy: { calculatedAt: 'desc' },
    });
    const jurisdiction = config?.jurisdiction || 'us';
    const formName = jurisdiction === 'ca'
      ? 'T2125 — Statement of Business Activities'
      : 'Schedule C — Profit or Loss from Business';
    const currency = config?.currency || 'USD';
    const fmt = (cents: number) =>
      `${currency === 'CAD' ? 'C' : ''}$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;

    const [allExp, withReceipts] = await Promise.all([
      db.abExpense.count({
        where: { tenantId, date: { gte: yearStart, lte: yearEnd }, isPersonal: false },
      }),
      db.abExpense.count({
        where: {
          tenantId,
          date: { gte: yearStart, lte: yearEnd },
          isPersonal: false,
          receiptUrl: { not: null },
        },
      }),
    ]);

    const effectiveRate = estimate && net > 0
      ? ((estimate.totalTaxCents / net) * 100).toFixed(1)
      : '0.0';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>AgentBook Tax Package — ${taxYear}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 0 auto; padding: 40px 20px; color: #1a1a1a; }
    h1 { font-size: 24px; border-bottom: 2px solid #10b981; padding-bottom: 8px; }
    h2 { font-size: 18px; color: #374151; margin-top: 32px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb; }
    th { background: #f9fafb; font-weight: 600; }
    td.amount { text-align: right; font-family: 'SF Mono', monospace; }
    .total-row { font-weight: 700; border-top: 2px solid #1a1a1a; }
    .summary-box { background: #f0fdf4; border: 1px solid #86efac; border-radius: 8px; padding: 20px; margin: 24px 0; }
    .summary-box h3 { margin: 0 0 12px 0; color: #166534; }
    .meta { color: #6b7280; font-size: 14px; }
    .footer { margin-top: 48px; padding-top: 16px; border-top: 1px solid #e5e7eb; font-size: 12px; color: #9ca3af; }
    @media print { body { padding: 0; } .no-print { display: none; } }
  </style>
</head>
<body>
  <h1>AgentBook Tax Package — ${taxYear}</h1>
  <p class="meta">Prepared for: Tenant ${tenantId} · Jurisdiction: ${jurisdiction.toUpperCase()} · Currency: ${currency}</p>
  <p class="meta">Generated: ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })} by AgentBook AI</p>

  <h2>${formName}</h2>

  <div class="summary-box">
    <h3>Summary</h3>
    <table>
      <tr><td>Gross Business Income</td><td class="amount">${fmt(gross)}</td></tr>
      <tr><td>Total Business Expenses</td><td class="amount">${fmt(totalExp)}</td></tr>
      <tr class="total-row"><td>Net Business Income</td><td class="amount">${fmt(net)}</td></tr>
    </table>
  </div>

  ${estimate ? `
  <h2>Tax Estimate</h2>
  <table>
    <tr><td>${jurisdiction === 'ca' ? 'CPP Self-Employed' : 'Self-Employment Tax'}</td><td class="amount">${fmt(estimate.seTaxCents)}</td></tr>
    <tr><td>Income Tax</td><td class="amount">${fmt(estimate.incomeTaxCents)}</td></tr>
    <tr class="total-row"><td>Total Estimated Tax</td><td class="amount">${fmt(estimate.totalTaxCents)}</td></tr>
    <tr><td>Effective Tax Rate</td><td class="amount">${effectiveRate}%</td></tr>
  </table>
  ` : ''}

  <h2>Expense Detail by ${jurisdiction === 'ca' ? 'T2125' : 'Schedule C'} Category</h2>
  <table>
    <thead><tr><th>Category</th><th style="text-align:right">Amount</th></tr></thead>
    <tbody>
      ${categories.sort((a, b) => b.cents - a.cents).map((c) => `<tr><td>${c.category}</td><td class="amount">${c.amount}</td></tr>`).join('\n      ')}
      <tr class="total-row"><td>Total Expenses</td><td class="amount">${fmt(totalExp)}</td></tr>
    </tbody>
  </table>

  <h2>Documentation Status</h2>
  <table>
    <tr><td>Total Expenses</td><td class="amount">${allExp}</td></tr>
    <tr><td>With Receipts</td><td class="amount">${withReceipts}</td></tr>
    <tr><td>Missing Receipts</td><td class="amount">${allExp - withReceipts}</td></tr>
    <tr><td>Receipt Coverage</td><td class="amount">${allExp > 0 ? Math.round((withReceipts / allExp) * 100) : 0}%</td></tr>
  </table>

  <div class="footer">
    <p>© ${taxYear} AgentBook · This document is generated from your accounting records. It is not a filed tax return.</p>
    <p>Consult a qualified tax professional before filing. AgentBook is not a CPA or tax advisor.</p>
  </div>
</body>
</html>`;

    return new NextResponse(html, { status: 200, headers: { 'Content-Type': 'text/html' } });
  } catch (err) {
    console.error('[agentbook-core/tax-package/html] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
