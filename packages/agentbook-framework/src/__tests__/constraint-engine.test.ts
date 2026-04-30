import { describe, it, expect } from 'vitest';
import {
  balanceInvariant,
  periodGate,
  amountThreshold,
  ConstraintEngine,
  type Constraint,
  type ConstraintResult,
} from '../constraint-engine.js';
import type { TenantConfig } from '../types.js';

const baseTenantConfig: TenantConfig = {
  tenant_id: 'tenant-1',
  business_type: 'sole_proprietor',
  jurisdiction: 'us',
  region: 'CA',
  currency: 'USD',
  locale: 'en-US',
  timezone: 'America/Los_Angeles',
  fiscal_year_start: 1,
  auto_approve_limit_cents: 500_00, // $500
};

// ---------------------------------------------------------------------------
// balanceInvariant
// ---------------------------------------------------------------------------
describe('balanceInvariant', () => {
  it('passes when debits equal credits', () => {
    const result = balanceInvariant.evaluate(
      {
        lines: [
          { debit_cents: 1000, credit_cents: 0 },
          { debit_cents: 0, credit_cents: 1000 },
        ],
      },
      baseTenantConfig,
    );
    expect(result.verdict).toBe('pass');
    expect(result.constraint_name).toBe('balance_invariant');
  });

  it('fails when debits do not equal credits', () => {
    const result = balanceInvariant.evaluate(
      {
        lines: [
          { debit_cents: 1000, credit_cents: 0 },
          { debit_cents: 0, credit_cents: 500 },
        ],
      },
      baseTenantConfig,
    );
    expect(result.verdict).toBe('fail');
    expect(result.reason).toContain('Debits');
    expect(result.reason).toContain('Credits');
    expect(result.details).toEqual({
      totalDebits: 1000,
      totalCredits: 500,
      difference: 500,
    });
  });

  it('fails when total is zero (both debits and credits are 0)', () => {
    const result = balanceInvariant.evaluate(
      {
        lines: [
          { debit_cents: 0, credit_cents: 0 },
        ],
      },
      baseTenantConfig,
    );
    expect(result.verdict).toBe('fail');
    expect(result.reason).toBe('Journal entry has zero total');
  });

  it('fails when lines array is empty', () => {
    const result = balanceInvariant.evaluate({ lines: [] }, baseTenantConfig);
    expect(result.verdict).toBe('fail');
    expect(result.reason).toBe('No journal lines provided');
  });

  it('fails when lines is undefined (no lines provided)', () => {
    const result = balanceInvariant.evaluate({}, baseTenantConfig);
    expect(result.verdict).toBe('fail');
    expect(result.reason).toBe('No journal lines provided');
  });
});

// ---------------------------------------------------------------------------
// periodGate
// ---------------------------------------------------------------------------
describe('periodGate', () => {
  it('passes when period is open', () => {
    const result = periodGate.evaluate(
      { period_status: 'open', period_id: '2025-01' },
      baseTenantConfig,
    );
    expect(result.verdict).toBe('pass');
  });

  it('fails when period is closed', () => {
    const result = periodGate.evaluate(
      { period_status: 'closed', period_id: '2024-12' },
      baseTenantConfig,
    );
    expect(result.verdict).toBe('fail');
    expect(result.reason).toContain('closed fiscal period');
    expect(result.reason).toContain('2024-12');
  });

  it('passes when period_status is undefined', () => {
    const result = periodGate.evaluate({}, baseTenantConfig);
    expect(result.verdict).toBe('pass');
  });
});

// ---------------------------------------------------------------------------
// amountThreshold
// ---------------------------------------------------------------------------
describe('amountThreshold', () => {
  it('passes when amount is below limit', () => {
    const result = amountThreshold.evaluate(
      { amount_cents: 100_00 }, // $100
      baseTenantConfig, // limit is $500
    );
    expect(result.verdict).toBe('pass');
  });

  it('escalates when amount exceeds limit', () => {
    const result = amountThreshold.evaluate(
      { amount_cents: 1000_00 }, // $1000
      baseTenantConfig, // limit is $500
    );
    expect(result.verdict).toBe('escalate');
    expect(result.reason).toContain('exceeds auto-approve limit');
    expect(result.details).toEqual({
      amount_cents: 1000_00,
      limit_cents: 500_00,
    });
  });

  it('passes when amount_cents is undefined', () => {
    const result = amountThreshold.evaluate({}, baseTenantConfig);
    expect(result.verdict).toBe('pass');
  });
});

// ---------------------------------------------------------------------------
// ConstraintEngine.evaluate()
// ---------------------------------------------------------------------------
describe('ConstraintEngine', () => {
  describe('evaluate()', () => {
    it('runs only constraints matching the enforcement phase', () => {
      const engine = new ConstraintEngine();
      // balance_invariant is pre_commit, period_gate and amount_threshold are pre_execution
      const results = engine.evaluate(
        ['balance_invariant', 'period_gate', 'amount_threshold'],
        'pre_execution',
        { period_status: 'open', amount_cents: 100 },
        baseTenantConfig,
      );
      // Only period_gate and amount_threshold match pre_execution
      const names = results.map(r => r.constraint_name);
      expect(names).toContain('period_gate');
      expect(names).toContain('amount_threshold');
      expect(names).not.toContain('balance_invariant');
    });

    it('stops on first hard_gate failure', () => {
      const engine = new ConstraintEngine();
      // period_gate is hard_gate, amount_threshold is escalation
      // Put period_gate first and make it fail
      const results = engine.evaluate(
        ['period_gate', 'amount_threshold'],
        'pre_execution',
        { period_status: 'closed', period_id: '2024-12', amount_cents: 1000_00 },
        baseTenantConfig,
      );
      // Should stop after period_gate failure
      expect(results).toHaveLength(1);
      expect(results[0].constraint_name).toBe('period_gate');
      expect(results[0].verdict).toBe('fail');
    });

    it('returns all results when no hard_gate failure', () => {
      const engine = new ConstraintEngine();
      const results = engine.evaluate(
        ['period_gate', 'amount_threshold'],
        'pre_execution',
        { period_status: 'open', amount_cents: 1000_00 },
        baseTenantConfig,
      );
      expect(results).toHaveLength(2);
      expect(results[0].verdict).toBe('pass');
      expect(results[1].verdict).toBe('escalate');
    });

    it('skips unknown constraint names gracefully', () => {
      const engine = new ConstraintEngine();
      const results = engine.evaluate(
        ['nonexistent_constraint'],
        'pre_execution',
        {},
        baseTenantConfig,
      );
      expect(results).toHaveLength(0);
    });
  });

  describe('hasBlocker()', () => {
    it('returns true when any result has verdict fail', () => {
      const engine = new ConstraintEngine();
      const results: ConstraintResult[] = [
        { constraint_name: 'a', verdict: 'pass' },
        { constraint_name: 'b', verdict: 'fail', reason: 'bad' },
      ];
      expect(engine.hasBlocker(results)).toBe(true);
    });

    it('returns false when no result has verdict fail', () => {
      const engine = new ConstraintEngine();
      const results: ConstraintResult[] = [
        { constraint_name: 'a', verdict: 'pass' },
        { constraint_name: 'b', verdict: 'escalate' },
      ];
      expect(engine.hasBlocker(results)).toBe(false);
    });
  });

  describe('hasEscalation()', () => {
    it('returns true when any result has verdict escalate', () => {
      const engine = new ConstraintEngine();
      const results: ConstraintResult[] = [
        { constraint_name: 'a', verdict: 'pass' },
        { constraint_name: 'b', verdict: 'escalate' },
      ];
      expect(engine.hasEscalation(results)).toBe(true);
    });

    it('returns false when no result has verdict escalate', () => {
      const engine = new ConstraintEngine();
      const results: ConstraintResult[] = [
        { constraint_name: 'a', verdict: 'pass' },
        { constraint_name: 'b', verdict: 'fail' },
      ];
      expect(engine.hasEscalation(results)).toBe(false);
    });
  });

  describe('register()', () => {
    it('adds custom constraints that can be evaluated', () => {
      const engine = new ConstraintEngine();
      const custom: Constraint = {
        name: 'custom_check',
        type: 'soft_check',
        enforcement: 'pre_execution',
        evaluate: () => ({ constraint_name: 'custom_check', verdict: 'pass' }),
      };
      engine.register(custom);

      const results = engine.evaluate(
        ['custom_check'],
        'pre_execution',
        {},
        baseTenantConfig,
      );
      expect(results).toHaveLength(1);
      expect(results[0].constraint_name).toBe('custom_check');
      expect(results[0].verdict).toBe('pass');
    });

    it('overrides existing constraint with same name', () => {
      const engine = new ConstraintEngine();
      const override: Constraint = {
        name: 'period_gate',
        type: 'hard_gate',
        enforcement: 'pre_execution',
        evaluate: () => ({
          constraint_name: 'period_gate',
          verdict: 'fail',
          reason: 'always fails',
        }),
      };
      engine.register(override);

      const results = engine.evaluate(
        ['period_gate'],
        'pre_execution',
        { period_status: 'open' },
        baseTenantConfig,
      );
      expect(results[0].verdict).toBe('fail');
      expect(results[0].reason).toBe('always fails');
    });
  });
});
