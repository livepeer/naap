/**
 * Mirrors the seed dataset in scripts/seed-e2e-user.ts. Tests refer to
 * these constants instead of hardcoding magic strings/numbers.
 */

export const SEED = {
  cashOpeningCents: 500_000,
  expenses: { count: 5, missingReceiptCount: 1 },
  invoices: {
    count: 4,
    draft: 'INV-E2E-DRAFT',
    sent: 'INV-E2E-SENT',
    overdue: 'INV-E2E-OVERDUE',
    paid: 'INV-E2E-PAID',
  },
  clients: { count: 3, names: ['Acme Corp', 'Beta Inc', 'Gamma LLC'] },
};

/**
 * Generate a unique tag for entities created during a test run, so
 * teardown can find them. Format: `e2e-{phase}-{ts}`.
 */
export function tag(phase: string): string {
  return `e2e-${phase}-${Date.now()}`;
}
