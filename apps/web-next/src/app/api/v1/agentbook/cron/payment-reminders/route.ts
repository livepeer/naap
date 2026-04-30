import { NextResponse } from 'next/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const INVOICE_API = process.env.AGENTBOOK_INVOICE_URL || 'http://localhost:4052';

  try {
    // Find overdue invoices (status = sent, past due date)
    const invoicesRes = await fetch(`${INVOICE_API}/api/v1/agentbook-invoice/invoices?status=sent`, {
      headers: { 'Content-Type': 'application/json' },
    });
    const invoicesData = await invoicesRes.json() as any;
    const now = new Date();
    const overdue = (invoicesData.data || []).filter((inv: any) => {
      if (!inv.dueDate) return false;
      const due = new Date(inv.dueDate);
      if (due >= now) return false;
      // Skip if reminded recently (min 3 days between reminders)
      if (inv.lastRemindedAt) {
        const lastReminded = new Date(inv.lastRemindedAt);
        const daysSince = (now.getTime() - lastReminded.getTime()) / (1000 * 60 * 60 * 24);
        if (daysSince < 3) return false;
      }
      return true;
    });

    let sent = 0;
    for (const inv of overdue.slice(0, 20)) {
      try {
        await fetch(`${INVOICE_API}/api/v1/agentbook-invoice/invoices/${inv.id}/remind`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tenant-id': inv.tenantId },
        });
        sent++;
      } catch { /* skip individual failures */ }
    }

    return NextResponse.json({ success: true, data: { checked: overdue.length, sent } });
  } catch (err) {
    return NextResponse.json({ success: false, error: String(err) }, { status: 500 });
  }
}
