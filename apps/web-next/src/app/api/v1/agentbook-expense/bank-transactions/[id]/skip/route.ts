/**
 * Bank transaction → skip / ignore (PR 9 — daily reconciliation diff).
 *
 * POST → marks the transaction matchStatus='ignored' so the morning
 * digest stops surfacing it. Tenant-scoped: refuses to act on rows that
 * don't belong to the resolved tenant. Errors are sanitized so we don't
 * leak Prisma internals.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { id } = await params;

    const txn = await db.abBankTransaction.findFirst({
      where: { id, tenantId },
    });
    if (!txn) {
      return NextResponse.json(
        { success: false, error: 'Transaction not found' },
        { status: 404 },
      );
    }

    await db.$transaction([
      db.abBankTransaction.update({
        where: { id: txn.id },
        data: { matchStatus: 'ignored' },
      }),
      db.abEvent.create({
        data: {
          tenantId,
          eventType: 'bank.txn_skipped',
          actor: 'user',
          action: { transactionId: txn.id, source: 'reconciliation' },
        },
      }),
    ]);

    return NextResponse.json({
      success: true,
      data: { transactionId: txn.id, matchStatus: 'ignored' },
    });
  } catch (err) {
    console.error('[bank-transactions/skip] failed:', err);
    return NextResponse.json(
      { success: false, error: 'Failed to skip transaction' },
      { status: 500 },
    );
  }
}
