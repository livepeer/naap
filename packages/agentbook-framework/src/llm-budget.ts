/**
 * LLM Budget Tracker — Per-tenant rate limiting and cost tracking.
 *
 * Enforces daily LLM call budgets to prevent runaway costs.
 * Tracks token usage for billing and analytics.
 */

export interface LLMUsageRecord {
  tenant_id: string;
  model_tier: 'haiku' | 'sonnet' | 'opus';
  input_tokens: number;
  output_tokens: number;
  cost_cents: number;
  timestamp: string;
}

// Cost per 1K tokens (approximate, configurable)
const TIER_COSTS: Record<string, { input: number; output: number }> = {
  haiku: { input: 0.025, output: 0.125 },    // $0.25/$1.25 per 1M tokens
  sonnet: { input: 0.3, output: 1.5 },       // $3/$15 per 1M tokens
  opus: { input: 1.5, output: 7.5 },         // $15/$75 per 1M tokens
};

export class LLMBudgetTracker {
  private dailyUsage: Map<string, { calls: number; costCents: number; date: string }> = new Map();
  private defaultDailyBudgetCents = 50; // $0.50/day default

  /**
   * Check if a tenant can make an LLM call (within budget).
   */
  canMakeCall(tenantId: string, dailyBudgetCents?: number): boolean {
    const budget = dailyBudgetCents || this.defaultDailyBudgetCents;
    const today = new Date().toISOString().split('T')[0];
    const key = `${tenantId}:${today}`;
    const usage = this.dailyUsage.get(key);

    if (!usage || usage.date !== today) return true;
    return usage.costCents < budget;
  }

  /**
   * Record an LLM call and its cost.
   */
  recordUsage(record: LLMUsageRecord): void {
    const today = new Date().toISOString().split('T')[0];
    const key = `${record.tenant_id}:${today}`;

    const existing = this.dailyUsage.get(key) || { calls: 0, costCents: 0, date: today };

    if (existing.date !== today) {
      // New day, reset
      existing.calls = 0;
      existing.costCents = 0;
      existing.date = today;
    }

    existing.calls += 1;
    existing.costCents += record.cost_cents;
    this.dailyUsage.set(key, existing);
  }

  /**
   * Calculate cost for a given usage.
   */
  static calculateCost(tier: string, inputTokens: number, outputTokens: number): number {
    const costs = TIER_COSTS[tier] || TIER_COSTS.haiku;
    const inputCost = (inputTokens / 1000) * costs.input;
    const outputCost = (outputTokens / 1000) * costs.output;
    return Math.ceil((inputCost + outputCost) * 100); // cents
  }

  /**
   * Get usage summary for a tenant.
   */
  getDailyUsage(tenantId: string): { calls: number; costCents: number } | null {
    const today = new Date().toISOString().split('T')[0];
    const key = `${tenantId}:${today}`;
    return this.dailyUsage.get(key) || null;
  }
}
