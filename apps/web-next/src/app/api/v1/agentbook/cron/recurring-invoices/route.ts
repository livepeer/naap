/**
 * Recurring Invoice Cron — Auto-generates invoices from recurring schedules.
 * Vercel cron: "0 6 * * *" (6 AM UTC daily)
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const now = new Date();
    const dueItems = await db.abRecurringInvoice.findMany({
      where: { status: 'active', nextDue: { lte: now } },
    });

    let generated = 0;

    for (const item of dueItems) {
      // Check end date
      if (item.endDate && now > item.endDate) {
        await db.abRecurringInvoice.update({ where: { id: item.id }, data: { status: 'completed' } });
        continue;
      }

      const client = await db.abClient.findFirst({ where: { id: item.clientId, tenantId: item.tenantId } });
      if (!client) continue;

      // Generate invoice number
      const year = now.getFullYear();
      const lastInvoice = await db.abInvoice.findFirst({
        where: { tenantId: item.tenantId, number: { startsWith: `INV-${year}-` } },
        orderBy: { number: 'desc' },
      });
      let nextSeq = 1;
      if (lastInvoice) nextSeq = parseInt(lastInvoice.number.split('-')[2], 10) + 1;
      const invoiceNumber = `INV-${year}-${String(nextSeq).padStart(4, '0')}`;

      const lines = (item.templateLines as any[]).map((l: any) => ({
        description: l.description,
        quantity: l.quantity || 1,
        rateCents: l.rateCents,
        amountCents: Math.round((l.quantity || 1) * l.rateCents),
      }));

      // Look up accounts
      const arAccount = await db.abAccount.findFirst({ where: { tenantId: item.tenantId, code: '1100' } });
      const revenueAccount = await db.abAccount.findFirst({ where: { tenantId: item.tenantId, code: '4000' } });
      if (!arAccount || !revenueAccount) continue;

      const dueDate = new Date(now);
      dueDate.setDate(dueDate.getDate() + item.daysToPay);

      await db.$transaction(async (tx) => {
        const je = await tx.abJournalEntry.create({
          data: {
            tenantId: item.tenantId, date: now,
            memo: `Recurring Invoice ${invoiceNumber} to ${client.name}`,
            sourceType: 'invoice', verified: true,
            lines: {
              create: [
                { accountId: arAccount.id, debitCents: item.totalCents, creditCents: 0, description: `AR - ${invoiceNumber}` },
                { accountId: revenueAccount.id, debitCents: 0, creditCents: item.totalCents, description: `Revenue - ${invoiceNumber}` },
              ],
            },
          },
        });

        const inv = await tx.abInvoice.create({
          data: {
            tenantId: item.tenantId, clientId: item.clientId, number: invoiceNumber,
            amountCents: item.totalCents, currency: item.currency,
            issuedDate: now, dueDate,
            status: item.autoSend ? 'sent' : 'draft',
            journalEntryId: je.id, recurringId: item.id,
            lines: { create: lines },
          },
        });

        await tx.abJournalEntry.update({ where: { id: je.id }, data: { sourceId: inv.id } });
        await tx.abClient.update({ where: { id: item.clientId }, data: { totalBilledCents: { increment: item.totalCents } } });

        await tx.abEvent.create({
          data: {
            tenantId: item.tenantId, eventType: 'invoice.auto_generated', actor: 'system',
            action: { invoiceId: inv.id, number: invoiceNumber, recurringId: item.id },
          },
        });
      });

      // Advance next due date
      const nextDue = new Date(item.nextDue);
      switch (item.frequency) {
        case 'weekly': nextDue.setDate(nextDue.getDate() + 7); break;
        case 'biweekly': nextDue.setDate(nextDue.getDate() + 14); break;
        case 'monthly': nextDue.setMonth(nextDue.getMonth() + 1); break;
        case 'quarterly': nextDue.setMonth(nextDue.getMonth() + 3); break;
        case 'annual': nextDue.setFullYear(nextDue.getFullYear() + 1); break;
      }

      await db.abRecurringInvoice.update({
        where: { id: item.id },
        data: { nextDue, lastGenerated: now, generatedCount: { increment: 1 } },
      });

      generated++;
    }

    return NextResponse.json({ success: true, generated, checked: dueItems.length, timestamp: now.toISOString() });
  } catch (err) {
    console.error('Recurring invoice cron error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
