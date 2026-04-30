/**
 * Daily Pulse Cron — Morning financial summary for all tenants.
 * Vercel cron: "0 13 * * *" (1 PM UTC)
 */
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';


export async function GET(request: NextRequest): Promise<NextResponse> {
  const authHeader = request.headers.get('authorization');
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    // Get all active tenants
    const tenants = await db.abTenantConfig.findMany();
    let processed = 0;

    for (const tenant of tenants) {
      // Check if it's morning (8 AM) in tenant's timezone
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tenant.timezone || 'America/New_York' });
      const hour = parseInt(formatter.format(now), 10);

      if (hour !== 8) continue; // Only send at 8 AM local time

      // Aggregate today's activity
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      const todayExpenses = await db.abExpense.aggregate({
        where: { tenantId: tenant.userId, date: { gte: today }, isPersonal: false },
        _sum: { amountCents: true },
        _count: true,
      });

      const missingReceipts = await db.abExpense.count({
        where: { tenantId: tenant.userId, receiptUrl: null, date: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } },
      });

      // Log the pulse event
      await db.abEvent.create({
        data: {
          tenantId: tenant.userId,
          eventType: 'proactive.daily_pulse',
          actor: 'system',
          action: {
            expenses_today_cents: todayExpenses._sum.amountCents || 0,
            expense_count: todayExpenses._count || 0,
            missing_receipts: missingReceipts,
          },
        },
      });

      processed++;

      // Auto-record bank transactions (Zero-Input Bookkeeping)
      const bankTxns = await db.abBankTransaction.findMany({
        where: { tenantId: tenant.userId, matchStatus: 'pending', pending: false },
        take: 50,
      });

      for (const tx of bankTxns) {
        // Check vendor pattern for auto-categorization
        const normalizedMerchant = (tx.merchantName || tx.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const pattern = await db.abPattern.findFirst({
          where: { tenantId: tenant.userId, vendorPattern: normalizedMerchant },
        });

        if (pattern && pattern.confidence >= 0.9 && tx.amount > 0) {
          // Auto-record silently
          await db.abExpense.create({
            data: {
              tenantId: tenant.userId,
              amountCents: Math.abs(tx.amount),
              categoryId: pattern.categoryId,
              date: new Date(tx.date),
              description: `Auto: ${tx.name || tx.merchantName}`,
              confidence: pattern.confidence,
            },
          });
          await db.abBankTransaction.update({
            where: { id: tx.id },
            data: { matchStatus: 'matched' },
          });
        }
      }
    }

    return NextResponse.json({ success: true, processed, timestamp: new Date().toISOString() });
  } catch (err) {
    console.error('Daily pulse cron error:', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }
}
