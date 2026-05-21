/**
 * Journal entries — list + create.
 *
 * Create enforces three hard constraints (code, not LLM):
 *   - balance invariant (sum debits == sum credits, both > 0)
 *   - period gate (cannot post into a closed AbFiscalPeriod)
 *   - account existence (every accountId belongs to this tenant)
 *
 * Auto-approve threshold from AbTenantConfig is logged but not blocking.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface JournalLineInput {
  accountId: string;
  debitCents?: number;
  creditCents?: number;
  description?: string;
}

interface CreateJournalBody {
  date?: string;
  memo?: string;
  sourceType?: string;
  sourceId?: string;
  lines?: JournalLineInput[];
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const body = (await request.json().catch(() => ({}))) as CreateJournalBody;
    const { date, memo, sourceType, sourceId, lines } = body;

    if (!date || !memo || !lines || !Array.isArray(lines) || lines.length < 2) {
      return NextResponse.json(
        { success: false, error: 'date, memo, and at least 2 lines are required' },
        { status: 400 },
      );
    }

    const totalDebits = lines.reduce((s, l) => s + (l.debitCents || 0), 0);
    const totalCredits = lines.reduce((s, l) => s + (l.creditCents || 0), 0);
    if (totalDebits !== totalCredits) {
      return NextResponse.json(
        {
          success: false,
          error: 'Balance invariant violated',
          details: {
            constraint: 'balance_invariant',
            totalDebits,
            totalCredits,
            difference: totalDebits - totalCredits,
          },
        },
        { status: 422 },
      );
    }
    if (totalDebits === 0) {
      return NextResponse.json(
        { success: false, error: 'Journal entry cannot have zero total' },
        { status: 422 },
      );
    }

    const entryDate = new Date(date);
    const period = await db.abFiscalPeriod.findUnique({
      where: {
        tenantId_year_month: {
          tenantId,
          year: entryDate.getFullYear(),
          month: entryDate.getMonth() + 1,
        },
      },
    });
    if (period && period.status === 'closed') {
      return NextResponse.json(
        {
          success: false,
          error: 'Period gate violated',
          details: {
            constraint: 'period_gate',
            year: entryDate.getFullYear(),
            month: entryDate.getMonth() + 1,
            status: 'closed',
          },
        },
        { status: 422 },
      );
    }

    const config = await db.abTenantConfig.findUnique({ where: { userId: tenantId } });
    const maxAmount = Math.max(totalDebits, totalCredits);
    if (config && maxAmount > config.autoApproveLimitCents) {
      console.warn(
        `Amount ${maxAmount} exceeds auto-approve limit ${config.autoApproveLimitCents} for tenant ${tenantId}`,
      );
    }

    const accountIds = lines.map((l) => l.accountId);
    const accounts = await db.abAccount.findMany({
      where: { id: { in: accountIds }, tenantId },
    });
    if (accounts.length !== new Set(accountIds).size) {
      const foundIds = new Set(accounts.map((a) => a.id));
      const missing = accountIds.filter((id) => !foundIds.has(id));
      return NextResponse.json(
        { success: false, error: `Account(s) not found: ${missing.join(', ')}` },
        { status: 400 },
      );
    }

    const entry = await db.$transaction(async (tx) => {
      const journalEntry = await tx.abJournalEntry.create({
        data: {
          tenantId,
          date: new Date(date),
          memo,
          sourceType: sourceType || 'manual',
          sourceId,
          verified: true,
          lines: {
            create: lines.map((l) => ({
              tenantId, // G-009
              accountId: l.accountId,
              debitCents: l.debitCents || 0,
              creditCents: l.creditCents || 0,
              description: l.description,
            })),
          },
        },
        include: { lines: true },
      });
      await tx.abEvent.create({
        data: {
          tenantId,
          eventType: 'journal_entry.created',
          actor: 'agent',
          action: {
            entry_id: journalEntry.id,
            memo,
            totalDebits,
            totalCredits,
            lineCount: lines.length,
          },
          constraintsPassed: ['balance_invariant', 'period_gate'],
          verificationResult: 'passed',
        },
      });
      return journalEntry;
    });

    return NextResponse.json({ success: true, data: entry }, { status: 201 });
  } catch (err) {
    console.error('[agentbook-core/journal-entries POST] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const params = request.nextUrl.searchParams;
    const startDate = params.get('startDate');
    const endDate = params.get('endDate');
    const sourceType = params.get('sourceType');
    const limit = parseInt(params.get('limit') || '50', 10);
    const offset = parseInt(params.get('offset') || '0', 10);

    const where: Record<string, unknown> = { tenantId };
    if (startDate || endDate) {
      const date: Record<string, Date> = {};
      if (startDate) date.gte = new Date(startDate);
      if (endDate) date.lte = new Date(endDate);
      where.date = date;
    }
    if (sourceType) where.sourceType = sourceType;

    const entries = await db.abJournalEntry.findMany({
      where,
      include: { lines: { include: { account: true } } },
      orderBy: { date: 'desc' },
      take: limit,
      skip: offset,
    });
    return NextResponse.json({ success: true, data: entries });
  } catch (err) {
    console.error('[agentbook-core/journal-entries GET] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
