/**
 * Shared chart-of-accounts lookup for mileage bookings.
 *
 * Mileage entries debit a vehicle/fuel/car expense account and credit
 * Owner's Equity (no cash actually moves on a personal-vehicle business
 * trip). Three call sites need the same pair of accounts: the POST route
 * (`mileage/route.ts`), the PATCH route (`mileage/[id]/route.ts`), and the
 * Telegram bot's `mileage.record` skill (`agentbook-bot-agent.ts`). Keep
 * the regex permissive (the route version's superset) so a tenant whose
 * chart calls it "Fuel" still matches.
 */

import 'server-only';
import { prisma as db } from '@naap/database';

export interface VehicleAccountPair {
  vehicleAccountId: string;
  equityAccountId: string;
}

/**
 * Find the vehicle-expense account a mileage debit should hit. Falls
 * back through three rules:
 *   1. taxCategory = "Line 9" (US Schedule C, "Car and Truck") OR
 *      taxCategory = "9281" / "Box 9281" (T2125 Motor vehicle expenses)
 *   2. account name matches /vehicle|car|fuel|motor/i
 *   3. account code 5100 (the seed default for US) or 5300 (spec hint)
 */
async function resolveVehicleExpenseAccountId(tenantId: string): Promise<string | null> {
  const candidates = await db.abAccount.findMany({
    where: { tenantId, accountType: 'expense', isActive: true },
    select: { id: true, code: true, name: true, taxCategory: true },
  });

  // 1. Tax-category match (US Line 9 / CA box 9281).
  let hit = candidates.find((a) =>
    a.taxCategory && /^line\s*9$|^9281$|box\s*9281/i.test(a.taxCategory),
  );
  if (hit) return hit.id;

  // 2. Name match — most permissive form (matches "Fuel", "Car & Truck",
  //    "Vehicle Expense", "Motor Vehicle"). Canonical regex per PR review.
  hit = candidates.find((a) => /^line\s*9$|vehicle|car|fuel|motor/i.test(a.name));
  if (hit) return hit.id;

  // 3. Common codes — 5100 (seed default) before 5300 (spec hint).
  hit = candidates.find((a) => a.code === '5100' || a.code === '5300');
  return hit?.id || null;
}

async function resolveOwnersEquityAccountId(tenantId: string): Promise<string | null> {
  // Default chart names it "Owner's Equity" at code 3000.
  const acc = await db.abAccount.findFirst({
    where: {
      tenantId,
      accountType: 'equity',
      OR: [
        { code: '3000' },
        { name: { contains: 'Owner', mode: 'insensitive' } },
        { name: { contains: 'Equity', mode: 'insensitive' } },
      ],
    },
    select: { id: true },
  });
  return acc?.id || null;
}

/**
 * Resolve both legs of a mileage journal entry. Returns null if either
 * side can't be matched — caller treats that as "skip JE, just save the
 * mileage entry"; the user is told their chart of accounts needs seeding.
 */
export async function resolveVehicleAccounts(
  tenantId: string,
): Promise<VehicleAccountPair | null> {
  const [vehicleAccountId, equityAccountId] = await Promise.all([
    resolveVehicleExpenseAccountId(tenantId),
    resolveOwnersEquityAccountId(tenantId),
  ]);
  if (!vehicleAccountId || !equityAccountId) return null;
  return { vehicleAccountId, equityAccountId };
}
