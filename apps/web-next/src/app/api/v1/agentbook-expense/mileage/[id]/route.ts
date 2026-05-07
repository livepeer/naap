/**
 * Single-entry mileage operations.
 *
 *   PATCH — recompute deductibleAmountCents at the current tier and
 *           atomically reverse the prior journal entry + post a new one
 *           (journal entries are immutable in this codebase, so edits
 *           are reversal + replacement, never line edits). All logic
 *           lives in `agentbook-mileage-service.ts` so the Telegram
 *           webhook can call it in-process (no `x-tenant-id` self-fetch).
 *   DELETE — hard delete; reverse the linked journal entry first so
 *            the trial balance stays consistent.
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';
import { updateMileageEntry } from '@/lib/agentbook-mileage-service';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface PatchBody {
  miles?: number;
  purpose?: string;
  clientId?: string | null;
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as PatchBody;

    const result = await updateMileageEntry(tenantId, id, {
      miles: body.miles,
      purpose: body.purpose,
      clientId: body.clientId,
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status },
      );
    }
    return NextResponse.json({ success: true, data: result.entry });
  } catch (err) {
    console.error('[agentbook-expense/mileage PATCH] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const { id } = await params;

    const existing = await db.abMileageEntry.findFirst({ where: { id, tenantId } });
    if (!existing) {
      return NextResponse.json(
        { success: false, error: 'mileage entry not found' },
        { status: 404 },
      );
    }

    await db.$transaction(async (tx) => {
      // Reverse the JE before deleting the row so the ledger stays
      // self-consistent without us having to teach `AbJournalEntry`
      // about a missing source.
      if (existing.journalEntryId) {
        const original = await tx.abJournalEntry.findUnique({
          where: { id: existing.journalEntryId },
          include: { lines: true },
        });
        if (original) {
          await tx.abJournalEntry.create({
            data: {
              tenantId,
              date: new Date(),
              memo: `REVERSAL: ${original.memo} (mileage delete)`,
              sourceType: 'mileage',
              sourceId: existing.id,
              verified: true,
              lines: {
                create: original.lines.map((l) => ({
                  accountId: l.accountId,
                  debitCents: l.creditCents,
                  creditCents: l.debitCents,
                  description: `Reversal: ${l.description || ''}`,
                })),
              },
            },
          });
        }
      }
      await tx.abMileageEntry.delete({ where: { id } });
      await tx.abEvent.create({
        data: {
          tenantId,
          eventType: 'mileage.deleted',
          actor: 'user',
          action: {
            mileageEntryId: id,
            miles: existing.miles,
            deductibleCents: existing.deductibleAmountCents,
          },
        },
      });
    });

    return NextResponse.json({ success: true, data: { id } });
  } catch (err) {
    console.error('[agentbook-expense/mileage DELETE] failed:', err);
    return NextResponse.json(
      { success: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
