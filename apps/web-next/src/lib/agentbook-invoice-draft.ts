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
import { convertCents } from './agentbook-fx';

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
  // Multi-currency (PR 13). Set only when the invoice was quoted in a
  // currency different from the tenant's booking currency.
  originalCurrency?: string;
  originalAmountCents?: number;
  fxRate?: number;
  fxRateSource?: string;
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
  const tenantCurrency = tenantConfig?.currency || 'USD';
  const quotedCurrency = input.parsed.currencyHint || tenantCurrency;

  const quotedLineItems = input.parsed.lines.map((l) => ({
    description: l.description || '',
    quantity: l.quantity || 1,
    rateCents: l.rateCents,
    amountCents: Math.round((l.quantity || 1) * l.rateCents),
  }));
  const quotedTotalCents = quotedLineItems.reduce((sum, l) => sum + l.amountCents, 0);

  // Multi-currency (PR 13). When quoted ≠ tenant booking currency, run
  // line-level conversion at issued-date so the booked amounts foot to
  // the converted total exactly. If the rate isn't available we still
  // book in the tenant currency (with the quoted amount as-is, no FX
  // metadata) — better than failing the draft outright. The user sees
  // a slightly off total but can edit before sending.
  const currency = tenantCurrency;
  let fx:
    | { rate: number; source: string; date: Date; originalAmountCents: number; bookedLineItems: typeof quotedLineItems; bookedTotalCents: number }
    | null = null;
  if (quotedCurrency !== tenantCurrency) {
    const conv = await convertCents(quotedTotalCents, quotedCurrency, tenantCurrency, issuedDate);
    if (conv) {
      // Rate the converter chose for the total — re-apply line-by-line
      // and round once at the end so cents foot.
      const rate = conv.rate.rate;
      const bookedLineItems = quotedLineItems.map((l) => ({
        ...l,
        rateCents: Math.round(l.rateCents * rate),
        amountCents: Math.round(l.amountCents * rate),
      }));
      // Use the convertCents-rounded total to avoid drift from per-line rounding.
      fx = {
        rate,
        source: conv.rate.source,
        date: conv.rate.date,
        originalAmountCents: quotedTotalCents,
        bookedLineItems,
        bookedTotalCents: conv.amountCents,
      };
    }
  }
  const lineItems = fx ? fx.bookedLineItems : quotedLineItems;
  const totalAmountCents = fx ? fx.bookedTotalCents : quotedTotalCents;
  // The fields we actually persist for the originalCurrency block.
  const originalCurrency = fx ? quotedCurrency : null;
  const originalAmountCents = fx ? fx.originalAmountCents : null;
  const fxRate = fx ? fx.rate : null;
  const fxRateSource = fx ? fx.source : null;
  const fxRateDate = fx ? fx.date : null;

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
            originalCurrency,
            originalAmountCents,
            fxRate,
            fxRateSource,
            fxRateDate,
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
            ...(fx
              ? {
                  originalCurrency,
                  originalAmountCents,
                  fxRate,
                  fxRateSource,
                }
              : {}),
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
        ...(fx
          ? {
              originalCurrency: quotedCurrency,
              originalAmountCents: quotedTotalCents,
              fxRate: fx.rate,
              fxRateSource: fx.source,
            }
          : {}),
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
