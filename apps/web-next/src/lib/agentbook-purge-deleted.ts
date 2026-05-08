/**
 * Soft-delete housekeeping (PR 26).
 *
 * Hard-deletes financial-entity rows whose `deletedAt` is older than
 * the 90-day restore window. Called by the daily cron at
 * `/api/v1/agentbook/cron/purge-deleted`.
 *
 * Why hard-delete at all? The restore window is the user's safety net.
 * Past it, the row has been off the books for a quarter — keeping it
 * around just bloats the tables and complicates GDPR-style deletion
 * requests. The 90-day boundary is matched in `agentbook-soft-delete.ts`
 * (`canRestore`) so a row that's not restorable is also not retained.
 */

import 'server-only';
import { prisma as db } from '@naap/database';
import { RESTORE_WINDOW_DAYS } from './agentbook-soft-delete';

export interface PurgeResult {
  expenses: number;
  invoices: number;
  clients: number;
  vendors: number;
  budgets: number;
  mileage: number;
  total: number;
  cutoff: Date;
}

/**
 * Real-delete every soft-deleted row whose `deletedAt` is more than
 * 90 days before `now`. Pass `now` explicitly so callers (cron handler,
 * tests) keep the function deterministic.
 */
export async function purgeSoftDeleted(now: Date = new Date()): Promise<PurgeResult> {
  const cutoff = new Date(now.getTime() - RESTORE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const where = { deletedAt: { lt: cutoff, not: null } } as const;

  const [expenses, invoices, clients, vendors, budgets, mileage] = await Promise.all([
    db.abExpense.deleteMany({ where }),
    db.abInvoice.deleteMany({ where }),
    db.abClient.deleteMany({ where }),
    db.abVendor.deleteMany({ where }),
    db.abBudget.deleteMany({ where }),
    db.abMileageEntry.deleteMany({ where }),
  ]);

  return {
    expenses: expenses.count,
    invoices: invoices.count,
    clients: clients.count,
    vendors: vendors.count,
    budgets: budgets.count,
    mileage: mileage.count,
    total:
      expenses.count + invoices.count + clients.count +
      vendors.count + budgets.count + mileage.count,
    cutoff,
  };
}
