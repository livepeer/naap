/**
 * Dashboard /activity feed — native Next.js route.
 *
 * Mixed recent-activity feed (expenses + invoice events + payments).
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveTenantId } from '../_helpers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface ActivityItem {
  id: string;
  kind: 'invoice_sent' | 'invoice_paid' | 'invoice_voided' | 'expense' | 'payment';
  label: string;
  amountCents: number;
  date: string;
  href?: string;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveTenantId(request);
    const limit = Math.min(50, Math.max(1, parseInt(request.nextUrl.searchParams.get('limit') || '10', 10)));

    const perSource = limit * 3;
    const since = new Date(Date.now() - 60 * 86_400_000);

    const [expenses, sentInvoices, voidedInvoices, payments] = await Promise.all([
      db.abExpense.findMany({
        where: { tenantId, isPersonal: false, date: { gte: since } },
        orderBy: { date: 'desc' },
        take: perSource,
        select: { id: true, description: true, amountCents: true, date: true },
      }),
      db.abInvoice.findMany({
        where: {
          tenantId,
          status: { in: ['sent', 'viewed', 'paid', 'overdue'] },
          updatedAt: { gte: since },
        },
        orderBy: { updatedAt: 'desc' },
        take: perSource,
        select: {
          id: true, number: true, status: true, amountCents: true, updatedAt: true,
          client: { select: { name: true } },
        },
      }),
      db.abInvoice.findMany({
        where: { tenantId, status: 'void', updatedAt: { gte: since } },
        orderBy: { updatedAt: 'desc' },
        take: perSource,
        select: { id: true, number: true, amountCents: true, updatedAt: true },
      }),
      db.abPayment.findMany({
        where: { tenantId, date: { gte: since } },
        orderBy: { date: 'desc' },
        take: perSource,
        select: {
          id: true, amountCents: true, date: true,
          invoice: { select: { number: true, client: { select: { name: true } } } },
        },
      }),
    ]);

    const items: ActivityItem[] = [];

    for (const e of expenses) {
      items.push({
        id: `exp:${e.id}`,
        kind: 'expense',
        label: `🧾 ${e.description || 'Expense'}`,
        amountCents: -e.amountCents,
        date: e.date.toISOString(),
        href: '/agentbook/expenses',
      });
    }

    for (const inv of sentInvoices) {
      items.push({
        id: `inv-sent:${inv.id}`,
        kind: 'invoice_sent',
        label: `↗ Sent invoice ${inv.number} — ${inv.client?.name || ''}`.trim(),
        amountCents: inv.amountCents,
        date: inv.updatedAt.toISOString(),
        href: '/agentbook/invoices',
      });
    }

    for (const inv of voidedInvoices) {
      items.push({
        id: `inv-void:${inv.id}`,
        kind: 'invoice_voided',
        label: `✕ Voided invoice ${inv.number}`,
        amountCents: 0,
        date: inv.updatedAt.toISOString(),
        href: '/agentbook/invoices',
      });
    }

    for (const p of payments) {
      items.push({
        id: `pay:${p.id}`,
        kind: 'invoice_paid',
        label: `⬇ Paid by ${p.invoice?.client?.name || 'client'} (${p.invoice?.number || ''})`,
        amountCents: p.amountCents,
        date: p.date.toISOString(),
        href: '/agentbook/invoices',
      });
    }

    items.sort((a, b) => b.date.localeCompare(a.date));
    return NextResponse.json({ success: true, data: items.slice(0, limit) });
  } catch (err) {
    console.error('[dashboard/activity] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
