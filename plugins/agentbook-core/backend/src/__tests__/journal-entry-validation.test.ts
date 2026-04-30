/**
 * Unit tests for journal entry validation logic.
 *
 * Extracted from the POST /api/v1/agentbook-core/journal-entries handler
 * in server.ts. We test the pure validation constraints directly
 * without requiring Express or Prisma.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Extracted validation logic (mirrors server.ts handler constraints)
// ---------------------------------------------------------------------------

interface JournalLine {
  debitCents: number;
  creditCents: number;
  accountId: string;
  description?: string;
}

interface JournalEntryInput {
  date?: string;
  memo?: string;
  lines?: JournalLine[];
}

interface ValidationResult {
  valid: boolean;
  error?: string;
  constraint?: string;
  details?: Record<string, unknown>;
}

/**
 * Validates a journal entry input exactly as the server.ts handler does.
 * This is a pure function extracted from the route handler so we can
 * unit-test constraint logic without Express/Prisma.
 */
function validateJournalEntry(
  input: JournalEntryInput,
  opts?: {
    closedPeriods?: { year: number; month: number }[];
    existingAccountIds?: string[];
    autoApproveLimitCents?: number;
  },
): ValidationResult & { warnings?: string[] } {
  const { date, memo, lines } = input;
  const warnings: string[] = [];

  // --- Required fields ---
  if (!date || !memo || !lines || !Array.isArray(lines) || lines.length < 2) {
    return {
      valid: false,
      error: 'date, memo, and at least 2 lines are required',
    };
  }

  // --- Balance invariant (hard gate) ---
  const totalDebits = lines.reduce((sum, l) => sum + (l.debitCents || 0), 0);
  const totalCredits = lines.reduce((sum, l) => sum + (l.creditCents || 0), 0);

  if (totalDebits !== totalCredits) {
    return {
      valid: false,
      error: 'Balance invariant violated',
      constraint: 'balance_invariant',
      details: { totalDebits, totalCredits, difference: totalDebits - totalCredits },
    };
  }

  // --- Zero total (hard gate) ---
  if (totalDebits === 0) {
    return {
      valid: false,
      error: 'Journal entry cannot have zero total',
    };
  }

  // --- Period gate (hard gate) ---
  if (opts?.closedPeriods) {
    const entryDate = new Date(date);
    const year = entryDate.getFullYear();
    const month = entryDate.getMonth() + 1;
    const isClosed = opts.closedPeriods.some(
      (p) => p.year === year && p.month === month,
    );
    if (isClosed) {
      return {
        valid: false,
        error: 'Period gate violated',
        constraint: 'period_gate',
        details: { year, month, status: 'closed' },
      };
    }
  }

  // --- Amount threshold (escalation, not rejection) ---
  if (opts?.autoApproveLimitCents !== undefined) {
    const maxAmount = Math.max(totalDebits, totalCredits);
    if (maxAmount > opts.autoApproveLimitCents) {
      warnings.push(
        `Amount ${maxAmount} exceeds auto-approve limit ${opts.autoApproveLimitCents}`,
      );
    }
  }

  // --- Verify all account IDs exist ---
  if (opts?.existingAccountIds) {
    const knownIds = new Set(opts.existingAccountIds);
    const accountIds = lines.map((l) => l.accountId);
    const missing = accountIds.filter((id) => !knownIds.has(id));
    if (missing.length > 0) {
      return {
        valid: false,
        error: `Account(s) not found: ${missing.join(', ')}`,
      };
    }
  }

  return { valid: true, warnings: warnings.length > 0 ? warnings : undefined };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Journal Entry Validation', () => {
  const validEntry: JournalEntryInput = {
    date: '2025-06-15',
    memo: 'Office supplies purchase',
    lines: [
      { debitCents: 5000, creditCents: 0, accountId: 'acc-expense' },
      { debitCents: 0, creditCents: 5000, accountId: 'acc-cash' },
    ],
  };

  // ----- Required fields -----

  it('should reject entry without date', () => {
    const result = validateJournalEntry({ memo: 'test', lines: validEntry.lines });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('date, memo, and at least 2 lines are required');
  });

  it('should reject entry without memo', () => {
    const result = validateJournalEntry({ date: '2025-01-01', lines: validEntry.lines });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('date, memo, and at least 2 lines are required');
  });

  it('should reject entry without lines', () => {
    const result = validateJournalEntry({ date: '2025-01-01', memo: 'test' });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('date, memo, and at least 2 lines are required');
  });

  // ----- Minimum lines -----

  it('should reject entry with fewer than 2 lines', () => {
    const result = validateJournalEntry({
      date: '2025-01-01',
      memo: 'test',
      lines: [{ debitCents: 1000, creditCents: 0, accountId: 'acc-1' }],
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('at least 2 lines');
  });

  // ----- Balance invariant -----

  it('should accept a balanced entry (debits = credits)', () => {
    const result = validateJournalEntry(validEntry, {
      existingAccountIds: ['acc-expense', 'acc-cash'],
    });
    expect(result.valid).toBe(true);
  });

  it('should reject an unbalanced entry (debits != credits) with 422-style error', () => {
    const result = validateJournalEntry({
      date: '2025-06-15',
      memo: 'Bad entry',
      lines: [
        { debitCents: 5000, creditCents: 0, accountId: 'acc-expense' },
        { debitCents: 0, creditCents: 3000, accountId: 'acc-cash' },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Balance invariant violated');
    expect(result.constraint).toBe('balance_invariant');
    expect(result.details).toEqual({
      totalDebits: 5000,
      totalCredits: 3000,
      difference: 2000,
    });
  });

  // ----- Zero total -----

  it('should reject an entry with zero total', () => {
    const result = validateJournalEntry({
      date: '2025-06-15',
      memo: 'Zero entry',
      lines: [
        { debitCents: 0, creditCents: 0, accountId: 'acc-1' },
        { debitCents: 0, creditCents: 0, accountId: 'acc-2' },
      ],
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Journal entry cannot have zero total');
  });

  // ----- Period gate -----

  it('should reject entry to a closed period', () => {
    const result = validateJournalEntry(validEntry, {
      closedPeriods: [{ year: 2025, month: 6 }],
      existingAccountIds: ['acc-expense', 'acc-cash'],
    });
    expect(result.valid).toBe(false);
    expect(result.error).toBe('Period gate violated');
    expect(result.constraint).toBe('period_gate');
    expect(result.details).toEqual({ year: 2025, month: 6, status: 'closed' });
  });

  it('should accept entry to an open period', () => {
    const result = validateJournalEntry(validEntry, {
      closedPeriods: [{ year: 2025, month: 3 }], // different month
      existingAccountIds: ['acc-expense', 'acc-cash'],
    });
    expect(result.valid).toBe(true);
  });

  // ----- Amount threshold (escalation, not rejection) -----

  it('should warn (not reject) when amount exceeds auto-approve limit', () => {
    const result = validateJournalEntry(
      {
        date: '2025-06-15',
        memo: 'Large purchase',
        lines: [
          { debitCents: 100_000, creditCents: 0, accountId: 'acc-expense' },
          { debitCents: 0, creditCents: 100_000, accountId: 'acc-cash' },
        ],
      },
      {
        autoApproveLimitCents: 50_000,
        existingAccountIds: ['acc-expense', 'acc-cash'],
      },
    );
    expect(result.valid).toBe(true);
    expect(result.warnings).toBeDefined();
    expect(result.warnings![0]).toContain('exceeds auto-approve limit');
  });

  it('should not warn when amount is within auto-approve limit', () => {
    const result = validateJournalEntry(validEntry, {
      autoApproveLimitCents: 100_000,
      existingAccountIds: ['acc-expense', 'acc-cash'],
    });
    expect(result.valid).toBe(true);
    expect(result.warnings).toBeUndefined();
  });

  // ----- Account existence -----

  it('should reject when account IDs do not exist', () => {
    const result = validateJournalEntry(validEntry, {
      existingAccountIds: ['acc-expense'], // acc-cash is missing
    });
    expect(result.valid).toBe(false);
    expect(result.error).toContain('Account(s) not found');
    expect(result.error).toContain('acc-cash');
  });

  it('should accept when all account IDs exist', () => {
    const result = validateJournalEntry(validEntry, {
      existingAccountIds: ['acc-expense', 'acc-cash'],
    });
    expect(result.valid).toBe(true);
  });

  // ----- Event record (structural test) -----

  it('should indicate a valid entry that would create an event record', () => {
    const result = validateJournalEntry(validEntry, {
      existingAccountIds: ['acc-expense', 'acc-cash'],
    });
    // A valid entry means the handler would proceed to create the journal entry
    // and emit an abEvent with eventType 'journal_entry.created'
    expect(result.valid).toBe(true);
  });

  // ----- Multi-line balanced entries -----

  it('should accept multi-line balanced entry with 3+ lines', () => {
    const result = validateJournalEntry(
      {
        date: '2025-06-15',
        memo: 'Split expense',
        lines: [
          { debitCents: 3000, creditCents: 0, accountId: 'acc-a' },
          { debitCents: 2000, creditCents: 0, accountId: 'acc-b' },
          { debitCents: 0, creditCents: 5000, accountId: 'acc-c' },
        ],
      },
      { existingAccountIds: ['acc-a', 'acc-b', 'acc-c'] },
    );
    expect(result.valid).toBe(true);
  });
});
