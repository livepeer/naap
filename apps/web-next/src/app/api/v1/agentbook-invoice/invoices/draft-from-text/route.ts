/**
 * Draft an invoice from a freeform NL message — entry point for the
 * "invoice Acme $5K for July consulting" Telegram flow.
 *
 *   1. Run the NL parser → ParsedInvoiceDraft (or null)
 *   2. Resolve the client by name (case-insensitive substring on
 *      AbClient.name within the tenant). 0 → ask. 1 → create. 2+ → ask.
 *   3. Persist via the shared `createInvoiceDraft` helper (race-safe
 *      numbering, no journal entry yet — the journal posts on send).
 *
 * Returns one of:
 *   • { success, data: { draftId, invoiceNumber, clientName, totalCents, lines, dueDate, currency, clientEmail } }
 *   • { success, ambiguous: true, candidates: [{id, name, email}, ...], parsed: ParsedInvoiceDraft }
 *   • { success, needsClarify: true, question: string, parsed?: ParsedInvoiceDraft }
 */

import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import { prisma as db } from '@naap/database';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';
import { parseInvoiceFromText, type ParsedInvoiceDraft } from '@/lib/agentbook-invoice-parser';
import { createInvoiceDraft } from '@/lib/agentbook-invoice-draft';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

interface DraftFromTextBody {
  text?: string;
  clientId?: string; // optional: caller can pre-pick a client (e.g. after picker)
  parsed?: ParsedInvoiceDraft; // optional: caller already parsed
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const tenantId = await resolveAgentbookTenant(request);
    const body = (await request.json().catch(() => ({}))) as DraftFromTextBody;
    const text = (body.text || '').trim();

    let parsed: ParsedInvoiceDraft | null = body.parsed ?? null;
    if (!parsed) {
      if (!text) {
        return NextResponse.json(
          { success: false, error: 'text is required' },
          { status: 400 },
        );
      }
      parsed = await parseInvoiceFromText(text);
    }

    if (!parsed) {
      return NextResponse.json({
        success: true,
        needsClarify: true,
        question: "I read that as an invoice request but couldn't pin down the client and amount. Try \"invoice Acme $5K for July consulting\".",
      });
    }

    // Caller forced a clientId (typical: ambiguous-picker callback).
    if (body.clientId) {
      const client = await db.abClient.findFirst({
        where: { id: body.clientId, tenantId },
        select: { id: true, name: true, email: true },
      });
      if (!client) {
        return NextResponse.json(
          { success: false, error: 'Client not found' },
          { status: 404 },
        );
      }
      const data = await createInvoiceDraft({ tenantId, client, parsed });
      return NextResponse.json({ success: true, data });
    }

    // Resolve client by name (case-insensitive substring match).
    const allClients = await db.abClient.findMany({
      where: { tenantId },
      select: { id: true, name: true, email: true },
    });
    const hint = parsed.clientNameHint.toLowerCase();
    const candidates = allClients.filter(
      (c) => c.name.toLowerCase().includes(hint) || hint.includes(c.name.toLowerCase()),
    );

    if (candidates.length === 0) {
      return NextResponse.json({
        success: true,
        needsClarify: true,
        question: `Which client is "${parsed.clientNameHint}"? I don't have one with that name on file.`,
        parsed,
      });
    }

    if (candidates.length > 1) {
      return NextResponse.json({
        success: true,
        ambiguous: true,
        candidates: candidates.map((c) => ({ id: c.id, name: c.name, email: c.email })),
        parsed,
      });
    }

    const data = await createInvoiceDraft({ tenantId, client: candidates[0], parsed });
    return NextResponse.json({ success: true, data });
  } catch (err) {
    // Don't leak Prisma / internal errors to the wire — the messages can
    // contain table names, constraint names, and even row contents. Log
    // server-side, return a generic 500 to the client.
    console.error('[agentbook-invoice/invoices/draft-from-text] failed:', err);
    return NextResponse.json(
      { success: false, error: 'Internal error drafting invoice. Please try again.' },
      { status: 500 },
    );
  }
}
