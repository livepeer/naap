/**
 * Verifier — Independent verification pass.
 *
 * The executor and the verifier MUST use different prompts.
 * The verifier's job is to find errors, not confirm success.
 * Verification includes programmatic checks AND LLM reasoning.
 *
 * A verification failure triggers rollback BEFORE any commit.
 */

import type { LLMRequest, LLMResponse, ToolResult } from './types.js';

export interface VerificationInput {
  intent_description: string;
  proposed_action: Record<string, unknown>;
  source_data: Record<string, unknown>;
  tool_results: ToolResult[];
}

export interface VerificationResult {
  passed: boolean;
  checks: VerificationCheck[];
  llm_assessment?: string;
  timestamp: string;
}

export interface VerificationCheck {
  name: string;
  passed: boolean;
  reason?: string;
}

type LLMCaller = (request: LLMRequest) => Promise<LLMResponse>;

export class Verifier {
  private llmCaller?: LLMCaller;

  constructor(llmCaller?: LLMCaller) {
    this.llmCaller = llmCaller;
  }

  /**
   * Run verification on proposed journal entry / action.
   * Combines programmatic checks with adversarial LLM review.
   */
  async verify(input: VerificationInput, tenantId: string): Promise<VerificationResult> {
    const checks: VerificationCheck[] = [];

    // === Programmatic Checks ===

    // 1. Balance check (if journal entry)
    const lines = input.proposed_action.lines as Array<{ debit_cents: number; credit_cents: number }> | undefined;
    if (lines) {
      const totalDebits = lines.reduce((sum, l) => sum + (l.debit_cents || 0), 0);
      const totalCredits = lines.reduce((sum, l) => sum + (l.credit_cents || 0), 0);
      checks.push({
        name: 'balance_check',
        passed: totalDebits === totalCredits && totalDebits > 0,
        reason: totalDebits !== totalCredits
          ? `Debits (${totalDebits}) != Credits (${totalCredits})`
          : totalDebits === 0 ? 'Zero total' : undefined,
      });
    }

    // 2. Amount reasonableness (basic range check)
    const amountCents = input.proposed_action.amount_cents as number | undefined;
    if (amountCents !== undefined) {
      checks.push({
        name: 'amount_positive',
        passed: amountCents > 0,
        reason: amountCents <= 0 ? `Amount must be positive, got ${amountCents}` : undefined,
      });
      checks.push({
        name: 'amount_reasonable',
        passed: amountCents < 100_000_00, // < $100,000
        reason: amountCents >= 100_000_00 ? `Amount ${amountCents} cents exceeds reasonableness threshold` : undefined,
      });
    }

    // 3. Date sanity
    const date = input.proposed_action.date as string | undefined;
    if (date) {
      const parsedDate = new Date(date);
      const now = new Date();
      const oneYearAgo = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
      const oneMonthAhead = new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());

      checks.push({
        name: 'date_sanity',
        passed: parsedDate >= oneYearAgo && parsedDate <= oneMonthAhead,
        reason: parsedDate < oneYearAgo
          ? `Date ${date} is more than 1 year in the past`
          : parsedDate > oneMonthAhead
            ? `Date ${date} is more than 1 month in the future`
            : undefined,
      });
    }

    // === LLM Verification (adversarial prompt) ===
    let llmAssessment: string | undefined;
    if (this.llmCaller) {
      try {
        const response = await this.llmCaller({
          tier: 'sonnet',
          tenant_id: tenantId,
          system_prompt: 'You are a financial auditor. Your job is to find errors in proposed accounting entries. Be skeptical. If something looks wrong, say so. If everything looks correct, say "PASS" and explain briefly why.',
          prompt: `Review this proposed accounting action:\n\nIntent: ${input.intent_description}\nProposed action: ${JSON.stringify(input.proposed_action, null, 2)}\nSource data: ${JSON.stringify(input.source_data, null, 2)}\n\nCheck:\n1. Does the amount match the source data?\n2. Is the category consistent with the vendor?\n3. Are debits and credits balanced?\n4. Does the date make sense?\n5. Any other concerns?`,
          max_tokens: 300,
          temperature: 0.1,
          response_format: 'text',
        });
        llmAssessment = response.content;

        checks.push({
          name: 'llm_verification',
          passed: response.content.toUpperCase().includes('PASS'),
          reason: response.content.toUpperCase().includes('PASS') ? undefined : response.content,
        });
      } catch (err) {
        // LLM failure is not a blocker — log and continue with programmatic checks only
        console.warn('LLM verification failed, using programmatic checks only:', err);
      }
    }

    const allPassed = checks.every(c => c.passed);

    return {
      passed: allPassed,
      checks,
      llm_assessment: llmAssessment,
      timestamp: new Date().toISOString(),
    };
  }
}
