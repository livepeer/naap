import { describe, it, expect } from 'vitest';
import { Verifier, type VerificationInput } from '../verifier.js';
import type { LLMRequest, LLMResponse } from '../types.js';

function makeInput(overrides?: Partial<VerificationInput>): VerificationInput {
  return {
    intent_description: 'record_expense',
    proposed_action: {},
    source_data: {},
    tool_results: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// balance_check
// ---------------------------------------------------------------------------
describe('Verifier', () => {
  describe('balance_check', () => {
    it('passes when debits equal credits and total > 0', async () => {
      const verifier = new Verifier();
      const result = await verifier.verify(
        makeInput({
          proposed_action: {
            lines: [
              { debit_cents: 5000, credit_cents: 0 },
              { debit_cents: 0, credit_cents: 5000 },
            ],
          },
        }),
        'tenant-1',
      );

      const check = result.checks.find(c => c.name === 'balance_check');
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
      expect(check!.reason).toBeUndefined();
    });

    it('fails when debits do not equal credits', async () => {
      const verifier = new Verifier();
      const result = await verifier.verify(
        makeInput({
          proposed_action: {
            lines: [
              { debit_cents: 5000, credit_cents: 0 },
              { debit_cents: 0, credit_cents: 3000 },
            ],
          },
        }),
        'tenant-1',
      );

      const check = result.checks.find(c => c.name === 'balance_check');
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.reason).toContain('Debits');
    });
  });

  // ---------------------------------------------------------------------------
  // amount_positive
  // ---------------------------------------------------------------------------
  describe('amount_positive', () => {
    it('passes for positive amount', async () => {
      const verifier = new Verifier();
      const result = await verifier.verify(
        makeInput({ proposed_action: { amount_cents: 1000 } }),
        'tenant-1',
      );

      const check = result.checks.find(c => c.name === 'amount_positive');
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it('fails for zero amount', async () => {
      const verifier = new Verifier();
      const result = await verifier.verify(
        makeInput({ proposed_action: { amount_cents: 0 } }),
        'tenant-1',
      );

      const check = result.checks.find(c => c.name === 'amount_positive');
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.reason).toContain('positive');
    });

    it('fails for negative amount', async () => {
      const verifier = new Verifier();
      const result = await verifier.verify(
        makeInput({ proposed_action: { amount_cents: -500 } }),
        'tenant-1',
      );

      const check = result.checks.find(c => c.name === 'amount_positive');
      expect(check!.passed).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------
  // amount_reasonable
  // ---------------------------------------------------------------------------
  describe('amount_reasonable', () => {
    it('passes for amount under $100,000', async () => {
      const verifier = new Verifier();
      const result = await verifier.verify(
        makeInput({ proposed_action: { amount_cents: 99_999_99 } }),
        'tenant-1',
      );

      const check = result.checks.find(c => c.name === 'amount_reasonable');
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it('fails for amount at or over $100,000', async () => {
      const verifier = new Verifier();
      const result = await verifier.verify(
        makeInput({ proposed_action: { amount_cents: 100_000_00 } }),
        'tenant-1',
      );

      const check = result.checks.find(c => c.name === 'amount_reasonable');
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.reason).toContain('exceeds reasonableness threshold');
    });
  });

  // ---------------------------------------------------------------------------
  // date_sanity
  // ---------------------------------------------------------------------------
  describe('date_sanity', () => {
    it('passes for a recent date', async () => {
      const verifier = new Verifier();
      const today = new Date().toISOString().split('T')[0];
      const result = await verifier.verify(
        makeInput({ proposed_action: { date: today } }),
        'tenant-1',
      );

      const check = result.checks.find(c => c.name === 'date_sanity');
      expect(check).toBeDefined();
      expect(check!.passed).toBe(true);
    });

    it('fails for a date more than 1 year in the past', async () => {
      const verifier = new Verifier();
      const twoYearsAgo = new Date();
      twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
      const dateStr = twoYearsAgo.toISOString().split('T')[0];

      const result = await verifier.verify(
        makeInput({ proposed_action: { date: dateStr } }),
        'tenant-1',
      );

      const check = result.checks.find(c => c.name === 'date_sanity');
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.reason).toContain('more than 1 year in the past');
    });

    it('fails for a date more than 1 month in the future', async () => {
      const verifier = new Verifier();
      const threeMonthsAhead = new Date();
      threeMonthsAhead.setMonth(threeMonthsAhead.getMonth() + 3);
      const dateStr = threeMonthsAhead.toISOString().split('T')[0];

      const result = await verifier.verify(
        makeInput({ proposed_action: { date: dateStr } }),
        'tenant-1',
      );

      const check = result.checks.find(c => c.name === 'date_sanity');
      expect(check).toBeDefined();
      expect(check!.passed).toBe(false);
      expect(check!.reason).toContain('more than 1 month in the future');
    });
  });

  // ---------------------------------------------------------------------------
  // verify() without LLM caller
  // ---------------------------------------------------------------------------
  describe('verify() without LLM caller', () => {
    it('runs only programmatic checks and has no llm_verification check', async () => {
      const verifier = new Verifier();
      const result = await verifier.verify(
        makeInput({
          proposed_action: {
            amount_cents: 5000,
            date: new Date().toISOString().split('T')[0],
            lines: [
              { debit_cents: 5000, credit_cents: 0 },
              { debit_cents: 0, credit_cents: 5000 },
            ],
          },
        }),
        'tenant-1',
      );

      expect(result.passed).toBe(true);
      expect(result.llm_assessment).toBeUndefined();
      expect(result.checks.find(c => c.name === 'llm_verification')).toBeUndefined();
      expect(result.timestamp).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------
  // verify() with mock LLM caller
  // ---------------------------------------------------------------------------
  describe('verify() with mock LLM caller', () => {
    it('includes llm_verification check when LLM returns PASS', async () => {
      const mockLLM = async (_req: LLMRequest): Promise<LLMResponse> => ({
        content: 'PASS - Everything looks correct.',
        model: 'claude-3-sonnet',
        tokens_used: { input: 100, output: 20 },
        cost_cents: 1,
      });

      const verifier = new Verifier(mockLLM);
      const result = await verifier.verify(
        makeInput({
          proposed_action: {
            amount_cents: 5000,
            lines: [
              { debit_cents: 5000, credit_cents: 0 },
              { debit_cents: 0, credit_cents: 5000 },
            ],
          },
        }),
        'tenant-1',
      );

      const llmCheck = result.checks.find(c => c.name === 'llm_verification');
      expect(llmCheck).toBeDefined();
      expect(llmCheck!.passed).toBe(true);
      expect(result.llm_assessment).toBe('PASS - Everything looks correct.');
    });

    it('fails llm_verification when LLM does not include PASS', async () => {
      const mockLLM = async (_req: LLMRequest): Promise<LLMResponse> => ({
        content: 'The category does not match the vendor type.',
        model: 'claude-3-sonnet',
        tokens_used: { input: 100, output: 30 },
        cost_cents: 1,
      });

      const verifier = new Verifier(mockLLM);
      const result = await verifier.verify(
        makeInput({
          proposed_action: {
            amount_cents: 5000,
            lines: [
              { debit_cents: 5000, credit_cents: 0 },
              { debit_cents: 0, credit_cents: 5000 },
            ],
          },
        }),
        'tenant-1',
      );

      const llmCheck = result.checks.find(c => c.name === 'llm_verification');
      expect(llmCheck).toBeDefined();
      expect(llmCheck!.passed).toBe(false);
      expect(llmCheck!.reason).toContain('category does not match');
      expect(result.passed).toBe(false);
    });

    it('gracefully handles LLM caller error (falls back to programmatic only)', async () => {
      const mockLLM = async (_req: LLMRequest): Promise<LLMResponse> => {
        throw new Error('LLM service unavailable');
      };

      const verifier = new Verifier(mockLLM);
      const result = await verifier.verify(
        makeInput({
          proposed_action: {
            amount_cents: 5000,
            lines: [
              { debit_cents: 5000, credit_cents: 0 },
              { debit_cents: 0, credit_cents: 5000 },
            ],
          },
        }),
        'tenant-1',
      );

      // LLM check should not be in the results since it threw
      expect(result.checks.find(c => c.name === 'llm_verification')).toBeUndefined();
      // Programmatic checks still pass
      expect(result.passed).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------
  // overall passed logic
  // ---------------------------------------------------------------------------
  describe('overall passed', () => {
    it('is true only when all checks pass', async () => {
      const verifier = new Verifier();

      // All good
      const good = await verifier.verify(
        makeInput({
          proposed_action: {
            amount_cents: 1000,
            date: new Date().toISOString().split('T')[0],
            lines: [
              { debit_cents: 1000, credit_cents: 0 },
              { debit_cents: 0, credit_cents: 1000 },
            ],
          },
        }),
        'tenant-1',
      );
      expect(good.passed).toBe(true);
      expect(good.checks.every(c => c.passed)).toBe(true);

      // One check fails (unbalanced lines)
      const bad = await verifier.verify(
        makeInput({
          proposed_action: {
            amount_cents: 1000,
            date: new Date().toISOString().split('T')[0],
            lines: [
              { debit_cents: 1000, credit_cents: 0 },
              { debit_cents: 0, credit_cents: 999 },
            ],
          },
        }),
        'tenant-1',
      );
      expect(bad.passed).toBe(false);
    });
  });
});
