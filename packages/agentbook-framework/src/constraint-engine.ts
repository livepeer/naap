/**
 * Constraint Engine — The agent proposes, the constraint engine disposes.
 *
 * All constraints are deterministic code, never LLM calls.
 * Runs BEFORE each tool call in the execution DAG.
 *
 * Three constraint types:
 * - hard_gate: blocks execution if violated (balance invariant, period gate)
 * - escalation: pauses execution and surfaces to human (amount threshold, new vendor)
 * - soft_check: logs warning but allows execution (anomaly detection)
 */

import type { TenantConfig } from './types.js';

export type ConstraintType = 'hard_gate' | 'escalation' | 'soft_check';
export type ConstraintEnforcement = 'pre_execution' | 'pre_commit' | 'post_execution';
export type ConstraintVerdict = 'pass' | 'fail' | 'escalate';

export interface ConstraintResult {
  constraint_name: string;
  verdict: ConstraintVerdict;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface Constraint {
  name: string;
  type: ConstraintType;
  enforcement: ConstraintEnforcement;
  evaluate(input: Record<string, unknown>, context: TenantConfig): ConstraintResult;
}

/**
 * Built-in accounting constraints.
 * Plugins can register additional constraints via skill manifests.
 */

export const balanceInvariant: Constraint = {
  name: 'balance_invariant',
  type: 'hard_gate',
  enforcement: 'pre_commit',
  evaluate(input) {
    const lines = input.lines as Array<{ debit_cents: number; credit_cents: number }> | undefined;
    if (!lines || lines.length === 0) {
      return { constraint_name: 'balance_invariant', verdict: 'fail', reason: 'No journal lines provided' };
    }

    const totalDebits = lines.reduce((sum, l) => sum + (l.debit_cents || 0), 0);
    const totalCredits = lines.reduce((sum, l) => sum + (l.credit_cents || 0), 0);

    if (totalDebits !== totalCredits) {
      return {
        constraint_name: 'balance_invariant',
        verdict: 'fail',
        reason: `Debits (${totalDebits}) != Credits (${totalCredits}). Difference: ${Math.abs(totalDebits - totalCredits)} cents.`,
        details: { totalDebits, totalCredits, difference: totalDebits - totalCredits },
      };
    }

    if (totalDebits === 0) {
      return { constraint_name: 'balance_invariant', verdict: 'fail', reason: 'Journal entry has zero total' };
    }

    return { constraint_name: 'balance_invariant', verdict: 'pass' };
  },
};

export const periodGate: Constraint = {
  name: 'period_gate',
  type: 'hard_gate',
  enforcement: 'pre_execution',
  evaluate(input) {
    const periodStatus = input.period_status as string | undefined;
    if (periodStatus === 'closed') {
      return {
        constraint_name: 'period_gate',
        verdict: 'fail',
        reason: `Cannot post to a closed fiscal period (${input.period_id}).`,
      };
    }
    return { constraint_name: 'period_gate', verdict: 'pass' };
  },
};

export const amountThreshold: Constraint = {
  name: 'amount_threshold',
  type: 'escalation',
  enforcement: 'pre_execution',
  evaluate(input, context) {
    const amountCents = input.amount_cents as number | undefined;
    if (amountCents && amountCents > context.auto_approve_limit_cents) {
      return {
        constraint_name: 'amount_threshold',
        verdict: 'escalate',
        reason: `Amount ${amountCents} cents exceeds auto-approve limit of ${context.auto_approve_limit_cents} cents.`,
        details: { amount_cents: amountCents, limit_cents: context.auto_approve_limit_cents },
      };
    }
    return { constraint_name: 'amount_threshold', verdict: 'pass' };
  },
};

export class ConstraintEngine {
  private constraints: Map<string, Constraint> = new Map();

  constructor() {
    // Register built-in constraints
    this.register(balanceInvariant);
    this.register(periodGate);
    this.register(amountThreshold);
  }

  register(constraint: Constraint): void {
    this.constraints.set(constraint.name, constraint);
  }

  /**
   * Evaluate all constraints for a given enforcement phase.
   * Returns on first hard_gate failure or escalation.
   */
  evaluate(
    constraintNames: string[],
    enforcement: ConstraintEnforcement,
    input: Record<string, unknown>,
    context: TenantConfig,
  ): ConstraintResult[] {
    const results: ConstraintResult[] = [];

    for (const name of constraintNames) {
      const constraint = this.constraints.get(name);
      if (!constraint) continue;
      if (constraint.enforcement !== enforcement) continue;

      const result = constraint.evaluate(input, context);
      results.push(result);

      // Hard gate failure — stop immediately
      if (result.verdict === 'fail' && constraint.type === 'hard_gate') {
        return results;
      }
    }

    return results;
  }

  /**
   * Check if any result blocks execution.
   */
  hasBlocker(results: ConstraintResult[]): boolean {
    return results.some(r => r.verdict === 'fail');
  }

  /**
   * Check if any result requires human escalation.
   */
  hasEscalation(results: ConstraintResult[]): boolean {
    return results.some(r => r.verdict === 'escalate');
  }
}
