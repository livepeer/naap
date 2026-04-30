/**
 * Unit tests for expense tracking logic.
 *
 * Extracted from the agentbook-expense server.ts:
 * - normalizeVendorName helper
 * - Expense validation (amountCents must be positive)
 * - Categorization pattern logic (user correction sets 0.95 confidence)
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Extracted from server.ts line 32-34
// ---------------------------------------------------------------------------

function normalizeVendorName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
}

// ---------------------------------------------------------------------------
// Extracted expense validation logic from POST handler (lines 42-43)
// ---------------------------------------------------------------------------

interface ExpenseInput {
  amountCents?: number;
  vendor?: string;
  categoryId?: string;
  date?: string;
  description?: string;
  receiptUrl?: string;
  confidence?: number;
  isPersonal?: boolean;
}

interface ExpenseValidationResult {
  valid: boolean;
  error?: string;
}

function validateExpense(input: ExpenseInput): ExpenseValidationResult {
  if (!input.amountCents || input.amountCents <= 0) {
    return { valid: false, error: 'amountCents must be a positive integer' };
  }
  return { valid: true };
}

// ---------------------------------------------------------------------------
// Pattern confidence logic from POST /expenses/:id/categorize (lines 215-230)
// ---------------------------------------------------------------------------

interface CategorizationUpdate {
  categoryId: string;
  source?: string;
}

interface PatternResult {
  vendorPattern: string;
  categoryId: string;
  confidence: number;
  source: string;
}

/**
 * When a user corrects a categorization, the system creates or updates
 * the vendor pattern at 0.95 confidence with source 'user_corrected'.
 */
function buildPatternFromCategorization(
  vendorNormalizedName: string,
  update: CategorizationUpdate,
): PatternResult {
  return {
    vendorPattern: vendorNormalizedName,
    categoryId: update.categoryId,
    confidence: 0.95,
    source: update.source || 'user_corrected',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('normalizeVendorName', () => {
  it('should lowercase "Starbucks" to "starbucks"', () => {
    expect(normalizeVendorName('Starbucks')).toBe('starbucks');
  });

  it('should strip non-alphanumeric from "The Keg Steakhouse & Bar"', () => {
    expect(normalizeVendorName('The Keg Steakhouse & Bar')).toBe('thekegsteakhousebar');
  });

  it('should handle "AMAZON.COM" → "amazoncom"', () => {
    expect(normalizeVendorName('AMAZON.COM')).toBe('amazoncom');
  });

  it('should handle "7-Eleven" → "7eleven"', () => {
    expect(normalizeVendorName('7-Eleven')).toBe('7eleven');
  });

  it('should handle empty string → ""', () => {
    expect(normalizeVendorName('')).toBe('');
  });

  it('should handle strings with only special characters', () => {
    expect(normalizeVendorName('!@#$%^&*()')).toBe('');
  });

  it('should handle unicode and accented characters by stripping them', () => {
    // The regex [^a-z0-9] strips non-ASCII after lowercasing
    expect(normalizeVendorName('Café Nero')).toBe('cafnero');
  });

  it('should handle mixed case with numbers', () => {
    expect(normalizeVendorName('Best Buy #1234')).toBe('bestbuy1234');
  });
});

describe('Expense Validation', () => {
  it('should reject expense with amountCents <= 0', () => {
    expect(validateExpense({ amountCents: 0 })).toEqual({
      valid: false,
      error: 'amountCents must be a positive integer',
    });
    expect(validateExpense({ amountCents: -500 })).toEqual({
      valid: false,
      error: 'amountCents must be a positive integer',
    });
  });

  it('should reject expense with missing amountCents', () => {
    expect(validateExpense({})).toEqual({
      valid: false,
      error: 'amountCents must be a positive integer',
    });
  });

  it('should accept expense with valid positive amountCents', () => {
    expect(validateExpense({ amountCents: 1500 })).toEqual({ valid: true });
  });

  it('should accept expense with amountCents = 1 (minimum valid)', () => {
    expect(validateExpense({ amountCents: 1 })).toEqual({ valid: true });
  });

  it('should accept expense with large amountCents', () => {
    expect(validateExpense({ amountCents: 10_000_000 })).toEqual({ valid: true });
  });
});

describe('Categorization Pattern Logic', () => {
  it('should create pattern at 0.95 confidence on user correction', () => {
    const result = buildPatternFromCategorization('starbucks', {
      categoryId: 'cat-meals',
    });
    expect(result).toEqual({
      vendorPattern: 'starbucks',
      categoryId: 'cat-meals',
      confidence: 0.95,
      source: 'user_corrected',
    });
  });

  it('should use custom source when provided', () => {
    const result = buildPatternFromCategorization('amazoncom', {
      categoryId: 'cat-supplies',
      source: 'agent_suggested',
    });
    expect(result.confidence).toBe(0.95);
    expect(result.source).toBe('agent_suggested');
  });

  it('should default source to "user_corrected" when not provided', () => {
    const result = buildPatternFromCategorization('7eleven', {
      categoryId: 'cat-gas',
    });
    expect(result.source).toBe('user_corrected');
  });

  it('should preserve the vendor pattern exactly as normalized', () => {
    const result = buildPatternFromCategorization('thekegsteakhousebar', {
      categoryId: 'cat-entertainment',
    });
    expect(result.vendorPattern).toBe('thekegsteakhousebar');
  });
});
