/**
 * Shared helper: persist a parsed NL invoice as an `AbInvoice` draft.
 *
 * Both call sites (the `draft-from-text` HTTP route and the bot agent's
 * `invoice.create_from_chat` step) funnel through this so they emit
 * byte-identical drafts and `AbEvent`s.
 *
 * Numbering (`INV-YYYY-NNNN`) is computed inside a `$transaction` and
 * retried on `P2002` to survive concurrent drafts. The unique constraint
 * `@@unique([tenantId, number])` is the source of truth — we just
 * cooperate with it instead of pretending no race exists.
 */

import 'server-only';
import { prisma as db } from '@naap/database';

export interface CreateDraftInput {
  tenantId: string;
  client: { id: string; name: string; email: string | null };
  parsed: {
    lines: Array<{ description: string; rateCents: number; quantity: number }>;
    description?: string;
    dueDateHint?: string;
    currencyHint?: string;
  };
  source?: string;
  issuedDate?: Date;
}

export interface CreateDraftResult {
  draftId: string;
  invoiceNumber: string;
  clientName: string;
  clientEmail: string | null;
  totalCents: number;
  lines: Array<{ description: string; rateCents: number; quantity: number; amountCents: number }>;
  dueDate: string;
  issuedDate: string;
  currency: string;
}

const NET_30_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_NUMBER_RETRIES = 3;
const NUMBER_BACKOFF_MS = 50;

function computeDueDate(hint: string | undefined, issued: Date): Date {
  if (hint && hint.toLowerCase() !== 'net-30') {
    const parsed = new Date(hint);
    if (!isNaN(parsed.getTime())) return parsed;
  }
  return new Date(issued.getTime() + NET_30_MS);
}

/**
 * Create an invoice draft. Race-safe on `INV-YYYY-NNNN` numbering: if a
 * concurrent insert grabs the same number we retry up to 3 times with
 * incremental backoff before bubbling the error.
 */
export async function createInvoiceDraft(input: CreateDraftInput): Promise<CreateDraftResult> {
  const issuedDate = input.issuedDate ?? new Date();
  const dueDate = computeDueDate(input.parsed.dueDateHint, issuedDate);
  const source = input.source ?? 'telegram';
  const year = issuedDate.getFullYear();

  const tenantConfig = await db.abTenantConfig.findUnique({
    where: { userId: input.tenantId },
    select: { currency: true },
  });
  const currency = input.parsed.currencyHint || tenantConfig?.currency || 'USD';

  const lineItems = input.parsed.lines.map((l) => ({
    description: l.description || '',
    quantity: l.quantity || 1,
    rateCents: l.rateCents,
    amountCents: Math.round((l.quantity || 1) * l.rateCents),
  }));
  const totalAmountCents = lineItems.reduce((sum, l) => sum + l.amountCents, 0);

  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_NUMBER_RETRIES; attempt++) {
    try {
      const inv = await db.$transaction(async (tx) => {
        const last = await tx.abInvoice.findFirst({
          where: { tenantId: input.tenantId, number: { startsWith: `INV-${year}-` } },
          orderBy: { number: 'desc' },
        });
        let nextSeq = 1;
        if (last) {
          const parts = last.number.split('-');
          const n = parseInt(parts[2], 10);
          if (!isNaN(n)) nextSeq = n + 1;
        }
        const invoiceNumber = `INV-${year}-${String(nextSeq).padStart(4, '0')}`;

        return tx.abInvoice.create({
          data: {
            tenantId: input.tenantId,
            clientId: input.client.id,
            number: invoiceNumber,
            amountCents: totalAmountCents,
            currency,
            issuedDate,
            dueDate,
            status: 'draft',
            source,
            lines: { create: lineItems },
          },
          include: { lines: true },
        });
      });

      // Outside the txn so a slow event write can't hold the row locks.
      await db.abEvent.create({
        data: {
          tenantId: input.tenantId,
          eventType: 'invoice.drafted_from_chat',
          actor: 'agent',
          action: {
            invoiceId: inv.id,
            number: inv.number,
            clientId: input.client.id,
            amountCents: totalAmountCents,
            lineCount: lineItems.length,
            source,
          },
        },
      });

      return {
        draftId: inv.id,
        invoiceNumber: inv.number,
        clientName: input.client.name,
        clientEmail: input.client.email,
        totalCents: totalAmountCents,
        lines: inv.lines.map((l) => ({
          description: l.description,
          rateCents: l.rateCents,
          quantity: l.quantity,
          amountCents: l.amountCents,
        })),
        dueDate: dueDate.toISOString(),
        issuedDate: issuedDate.toISOString(),
        currency,
      };
    } catch (err) {
      lastErr = err;
      const code = (err as { code?: string } | null)?.code;
      if (code === 'P2002' && attempt < MAX_NUMBER_RETRIES - 1) {
        await new Promise((r) => setTimeout(r, NUMBER_BACKOFF_MS * (attempt + 1)));
        continue;
      }
      throw err;
    }
  }
  // unreachable — the loop either returns or throws — but keep TS happy.
  throw lastErr;
}
