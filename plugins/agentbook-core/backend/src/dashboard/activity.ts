/**
 * Dashboard /activity feed.
 *
 * Unified recent-activity feed mixing invoice events (sent/voided),
 * expenses, and payments — sorted by date.
 *
 * Note: AbInvoice has no `sentAt`/`voidedAt` columns — we use
 * `updatedAt` filtered by `status` as a proxy for recent state changes.
 */

import type { Request, Response } from 'express';
import { db } from '../db/client.js';

export interface ActivityItem {
  id: string;
  kind: 'invoice_sent' | 'invoice_paid' | 'invoice_voided' | 'expense' | 'payment';
  label: string;
  amountCents: number;
  date: string;
  href?: string;
}

export async function handleDashboardActivity(req: Request, res: Response): Promise<void> {
  const tenantId: string = (req as any).tenantId;
  const limit = Math.min(50, Math.max(1, parseInt(String(req.query.limit || '10'), 10)));

  // Pull a window of ~3× limit per source, then merge & truncate.
  const perSource = limit * 3;
  const since = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // last 60 days

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
        id: true,
        number: true,
        status: true,
        amountCents: true,
        updatedAt: true,
        client: { select: { name: true } },
      },
    }),
    db.abInvoice.findMany({
      where: { tenantId, status: 'void', updatedAt: { gte: since } },
      orderBy: { updatedAt: 'desc' },
      take: perSource,
      select: {
        id: true,
        number: true,
        amountCents: true,
        updatedAt: true,
      },
    }),
    db.abPayment.findMany({
      where: { tenantId, date: { gte: since } },
      orderBy: { date: 'desc' },
      take: perSource,
      select: {
        id: true,
        amountCents: true,
        date: true,
        invoice: {
          select: {
            number: true,
            client: { select: { name: true } },
          },
        },
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
      href: `/agentbook/expenses`,
    });
  }

  for (const inv of sentInvoices) {
    items.push({
      id: `inv-sent:${inv.id}`,
      kind: 'invoice_sent',
      label: `↗ Sent invoice ${inv.number} — ${inv.client?.name || ''}`.trim(),
      amountCents: inv.amountCents,
      date: inv.updatedAt.toISOString(),
      href: `/agentbook/invoices`,
    });
  }

  for (const inv of voidedInvoices) {
    items.push({
      id: `inv-void:${inv.id}`,
      kind: 'invoice_voided',
      label: `✕ Voided invoice ${inv.number}`,
      amountCents: 0,
      date: inv.updatedAt.toISOString(),
      href: `/agentbook/invoices`,
    });
  }

  for (const p of payments) {
    items.push({
      id: `pay:${p.id}`,
      kind: 'invoice_paid',
      label: `⬇ Paid by ${p.invoice?.client?.name || 'client'} (${p.invoice?.number || ''})`,
      amountCents: p.amountCents,
      date: p.date.toISOString(),
      href: `/agentbook/invoices`,
    });
  }

  items.sort((a, b) => b.date.localeCompare(a.date));
  res.json({ success: true, data: items.slice(0, limit) });
}
