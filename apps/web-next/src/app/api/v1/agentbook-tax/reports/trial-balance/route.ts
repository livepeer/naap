/**
 * Trial balance — debit / credit columns per account as of a date.
 * Differs from agentbook-core/trial-balance: this version splits the
 * net balance into debit and credit columns (not a signed balance).
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
    const asOfParam = request.nextUrl.searchParams.get('asOfDate');
    const asOfDate = asOfParam ? new Date(asOfParam) : new Date();

    const accounts = await db.abAccount.findMany({
      where: { tenantId, isActive: true },
      orderBy: { code: 'asc' },
    });

    const lines: {
      accountId: string;
      code: string;
      name: string;
      accountType: string;
      debitCents: number;
      creditCents: number;
    }[] = [];
    let totalDebitCents = 0;
    let totalCreditCents = 0;

    for (const acct of accounts) {
      const agg = await db.abJournalLine.aggregate({
        where: { accountId: acct.id, entry: { tenantId, date: { lte: asOfDate } } },
        _sum: { debitCents: true, creditCents: true },
      });
      const totalDebits = agg._sum.debitCents || 0;
      const totalCredits = agg._sum.creditCents || 0;
      const netBalance = totalDebits - totalCredits;
      if (totalDebits !== 0 || totalCredits !== 0) {
        const debitBalance = netBalance > 0 ? netBalance : 0;
        const creditBalance = netBalance < 0 ? Math.abs(netBalance) : 0;
        lines.push({
          accountId: acct.id,
          code: acct.code,
          name: acct.name,
          accountType: acct.accountType,
          debitCents: debitBalance,
          creditCents: creditBalance,
        });
        totalDebitCents += debitBalance;
        totalCreditCents += creditBalance;
      }
    }

    await db.abEvent.create({
      data: {
        tenantId,
        eventType: 'report.trial_balance.generated',
        actor: 'agent',
        action: {
          asOfDate: asOfDate.toISOString(),
          accountCount: lines.length,
          totalDebitCents,
          totalCreditCents,
          balanced: totalDebitCents === totalCreditCents,
        },
      },
    });

    return NextResponse.json({
      success: true,
      data: {
        asOfDate: asOfDate.toISOString(),
        lines,
        totalDebitCents,
        totalCreditCents,
        balanced: totalDebitCents === totalCreditCents,
      },
    });
  } catch (err) {
    console.error('[agentbook-tax/reports/trial-balance] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
