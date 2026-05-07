/**
 * In-process mileage service. Used by:
 *   • `mileage/[id]/route.ts` PATCH handler
 *   • Telegram webhook (the "tap ✏️ Edit miles, send a number" follow-up)
 *
 * Originally the webhook re-entered the PATCH route via `fetch` with an
 * `x-tenant-id` header, which is a tenant-spoof vector if the route is
 * internet-reachable (see PR review). The fix is to call this helper
 * directly in-process from both call sites — single source of truth for
 * the reverse-and-repost JE logic, no internet hop, no header trust.
 */

import 'server-only';
import { prisma as db } from '@naap/database';
import { getMileageRate } from './agentbook-mileage-rates';
import { resolveVehicleAccounts } from './agentbook-account-resolver';

export interface MileagePatch {
  miles?: number;
  purpose?: string;
  clientId?: string | null;
}

export interface UpdateMileageResult {
  ok: true;
  entry: Awaited<ReturnType<typeof db.abMileageEntry.update>>;
}

export interface UpdateMileageError {
  ok: false;
  status: number;
  error: string;
}

const PURPOSE_MAX = 500;

/**
 * Patch a mileage entry. Reverses + reposts the linked journal entry
 * when `deductibleAmountCents` actually changes. CRA tier selection
 * uses YTD-before-this-trip (date < trip date) so backdated edits don't
 * see future km in their tier calc.
 *
 * Returns a discriminated union so callers can render a friendly error
 * without re-deriving HTTP semantics. The PATCH route translates this to
 * a NextResponse; the Telegram webhook translates it to a chat reply.
 */
export async function updateMileageEntry(
  tenantId: string,
  entryId: string,
  patch: MileagePatch,
): Promise<UpdateMileageResult | UpdateMileageError> {
  const existing = await db.abMileageEntry.findFirst({
    where: { id: entryId, tenantId },
  });
  if (!existing) {
    return { ok: false, status: 404, error: 'mileage entry not found' };
  }

  const newMiles =
    typeof patch.miles === 'number' && isFinite(patch.miles) && patch.miles > 0
      ? patch.miles
      : existing.miles;
  const newPurpose =
    (patch.purpose && patch.purpose.trim())
      ? patch.purpose.trim().slice(0, PURPOSE_MAX)
      : existing.purpose;
  const newClientId =
    patch.clientId === undefined ? existing.clientId : patch.clientId;

  // CRA tier selection: YTD-before-the-trip-date, NOT YTD-end-of-year, so
  // backdating a trip to (say) Jan 15 doesn't accidentally count December
  // km in this trip's tier calc. Also excludes the entry itself so the
  // edit is idempotent.
  const tripYear = existing.date.getUTCFullYear();
  let ratePerUnitCents = existing.ratePerUnitCents;
  if (existing.jurisdiction === 'ca') {
    const start = new Date(Date.UTC(tripYear, 0, 1));
    const others = await db.abMileageEntry.findMany({
      where: {
        tenantId,
        unit: existing.unit,
        date: { gte: start, lt: existing.date },
        NOT: { id: entryId },
      },
      select: { miles: true },
    });
    const ytd = others.reduce((s, r) => s + r.miles, 0);
    ratePerUnitCents = getMileageRate('ca', tripYear, ytd).ratePerUnitCents;
  } else {
    ratePerUnitCents = getMileageRate('us', tripYear, 0).ratePerUnitCents;
  }
  const newDeductibleCents = Math.round(newMiles * ratePerUnitCents);

  const updated = await db.$transaction(async (tx) => {
    let nextJeId: string | null = existing.journalEntryId;

    // Reverse + repost when the booked amount actually changed.
    if (existing.journalEntryId && newDeductibleCents !== existing.deductibleAmountCents) {
      const original = await tx.abJournalEntry.findUnique({
        where: { id: existing.journalEntryId },
        include: { lines: true },
      });
      if (original) {
        const reversal = await tx.abJournalEntry.create({
          data: {
            tenantId,
            date: new Date(),
            memo: `REVERSAL: ${original.memo} (mileage edit)`,
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

        // Prefer the accounts the original JE used (so the trial balance
        // lands on the same line). Fall back to chart resolution.
        const debitLine = original.lines.find((l) => l.debitCents > 0);
        const creditLine = original.lines.find((l) => l.creditCents > 0);
        let vehicleAcctId = debitLine?.accountId || null;
        let equityAcctId = creditLine?.accountId || null;
        if (!vehicleAcctId || !equityAcctId) {
          const resolved = await resolveVehicleAccounts(tenantId);
          if (resolved) {
            vehicleAcctId = vehicleAcctId || resolved.vehicleAccountId;
            equityAcctId = equityAcctId || resolved.equityAccountId;
          }
        }

        if (vehicleAcctId && equityAcctId && newDeductibleCents > 0) {
          const replacement = await tx.abJournalEntry.create({
            data: {
              tenantId,
              date: existing.date,
              memo: `Mileage (amended): ${newMiles} ${existing.unit} — ${newPurpose}`,
              sourceType: 'mileage',
              sourceId: existing.id,
              verified: true,
              lines: {
                create: [
                  {
                    accountId: vehicleAcctId,
                    debitCents: newDeductibleCents,
                    creditCents: 0,
                    description: `Mileage @ ${ratePerUnitCents}¢/${existing.unit}`,
                  },
                  {
                    accountId: equityAcctId,
                    debitCents: 0,
                    creditCents: newDeductibleCents,
                    description: 'Personal vehicle, no cash outlay',
                  },
                ],
              },
            },
          });
          nextJeId = replacement.id;
        } else {
          // Account lookup failed at edit time. Don't orphan the entry —
          // point it at the reversal so the row still references SOME JE
          // and the ledger remains traceable. Logged so an operator can
          // re-seed the chart of accounts and a follow-up edit can repost.
          console.warn(
            `[mileage:updateMileageEntry] account resolver returned null at repost; ` +
              `entry ${entryId} now points at reversal ${reversal.id}. ` +
              `Re-seed chart of accounts to restore JE pairing.`,
          );
          nextJeId = reversal.id;
        }
      }
    }

    const row = await tx.abMileageEntry.update({
      where: { id: entryId },
      data: {
        miles: newMiles,
        purpose: newPurpose,
        clientId: newClientId,
        ratePerUnitCents,
        deductibleAmountCents: newDeductibleCents,
        journalEntryId: nextJeId,
      },
    });

    await tx.abEvent.create({
      data: {
        tenantId,
        eventType: 'mileage.updated',
        actor: 'user',
        action: {
          mileageEntryId: entryId,
          previousMiles: existing.miles,
          newMiles,
          previousDeductibleCents: existing.deductibleAmountCents,
          newDeductibleCents,
        },
      },
    });

    return row;
  });

  return { ok: true, entry: updated };
}
