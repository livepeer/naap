/**
 * Credit-card statement import — match each transaction against
 * existing expenses (within $5% / 2-day window), skip duplicates
 * already imported as cc_statement, otherwise create a pending_review
 * expense with source='cc_statement'.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

interface CcTxn {
  date: string;
  amount: number;
  description: string;
  merchant?: string;
}

interface ImportBody {
  transactions?: CcTxn[];
  csv?: string;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const body = (await request.json().catch(() => ({}))) as ImportBody;
    let txns: CcTxn[] = body.transactions || [];
    const csv = body.csv;

    if (csv && typeof csv === 'string' && txns.length === 0) {
      const lines = csv.trim().split('\n');
      if (lines.length < 2) {
        return NextResponse.json({ success: false, error: 'CSV has no data rows' }, { status: 400 });
      }
      const headers = lines[0].split(',').map((h) => h.trim().toLowerCase().replace(/"/g, ''));
      for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(',').map((v) => v.trim().replace(/"/g, ''));
        const row: Record<string, string> = {};
        headers.forEach((h, idx) => {
          row[h] = vals[idx] || '';
        });
        const dateCol =
          headers.find((h) => ['date', 'transaction date', 'trans date', 'posted date'].includes(h)) || headers[0];
        const amountCol =
          headers.find((h) => ['amount', 'debit', 'charge'].includes(h)) ||
          headers.find((h) => h.includes('amount')) ||
          headers[1];
        const descCol =
          headers.find((h) => ['description', 'merchant', 'name', 'memo'].includes(h)) || headers[2];
        const merchantCol = headers.find((h) => h.includes('merchant'));

        const amount = Math.abs(parseFloat((row[amountCol] || '0').replace(/[^0-9.-]/g, '')));
        if (amount > 0) {
          txns.push({
            date: row[dateCol],
            amount: Math.round(amount * 100),
            description: row[descCol] || `CC transaction row ${i + 1}`,
            merchant: merchantCol ? row[merchantCol] : undefined,
          });
        }
      }
    }

    if (txns.length === 0) {
      return NextResponse.json({ success: false, error: 'No transactions to import' }, { status: 400 });
    }

    const results = {
      matched: 0,
      created: 0,
      duplicates: 0,
      errors: 0,
      details: [] as { action: string; expenseId: string; amount: number; description: string; status?: string }[],
    };

    for (const txn of txns) {
      const amountCents =
        typeof txn.amount === 'number' && txn.amount > 100 ? txn.amount : Math.round((txn.amount || 0) * 100);
      const txnDate = new Date(txn.date);
      if (isNaN(txnDate.getTime()) || amountCents <= 0) {
        results.errors++;
        continue;
      }

      const matchWindow = 2 * 86_400_000;

      const matchingExpense = await db.abExpense.findFirst({
        where: {
          tenantId,
          amountCents: { gte: Math.round(amountCents * 0.95), lte: Math.round(amountCents * 1.05) },
          date: { gte: new Date(txnDate.getTime() - matchWindow), lte: new Date(txnDate.getTime() + matchWindow) },
        },
      });
      if (matchingExpense) {
        results.matched++;
        results.details.push({
          action: 'matched',
          expenseId: matchingExpense.id,
          amount: amountCents,
          description: txn.description,
        });
        continue;
      }

      const duplicate = await db.abExpense.findFirst({
        where: {
          tenantId,
          source: 'cc_statement',
          amountCents: { gte: Math.round(amountCents * 0.99), lte: Math.round(amountCents * 1.01) },
          date: {
            gte: new Date(txnDate.getTime() - 86_400_000),
            lte: new Date(txnDate.getTime() + 86_400_000),
          },
        },
      });
      if (duplicate) {
        results.duplicates++;
        continue;
      }

      const vendorName = txn.merchant || txn.description.split(/\s{2,}/)[0] || txn.description;
      let vendorId: string | null = null;
      if (vendorName) {
        const normalized = vendorName.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
        if (normalized) {
          const vendor = await db.abVendor.upsert({
            where: { tenantId_normalizedName: { tenantId, normalizedName: normalized } },
            update: { lastSeen: new Date(), transactionCount: { increment: 1 } },
            create: { tenantId, name: vendorName, normalizedName: normalized },
          });
          vendorId = vendor.id;
        }
      }

      const expense = await db.abExpense.create({
        data: {
          tenantId,
          amountCents,
          date: txnDate,
          description: txn.description,
          vendorId,
          source: 'cc_statement',
          status: 'pending_review',
          confidence: 0.6,
          paymentMethod: 'credit_card',
        },
      });

      results.created++;
      results.details.push({
        action: 'created',
        expenseId: expense.id,
        amount: amountCents,
        description: txn.description,
        status: 'pending_review',
      });
    }

    await db.abEvent.create({
      data: {
        tenantId,
        eventType: 'cc_statement.imported',
        actor: 'user',
        action: {
          total: txns.length,
          matched: results.matched,
          created: results.created,
          duplicates: results.duplicates,
        },
      },
    });

    return NextResponse.json({ success: true, data: results });
  } catch (err) {
    console.error('[agentbook-expense/import/cc-statement] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
