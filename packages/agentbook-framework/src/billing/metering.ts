/**
 * Usage Metering — Tracks per-tenant usage for billing.
 * Meters: transactions, LLM calls, storage, API calls.
 * Feeds into A3P's billing system via service-gateway.
 */

export interface UsageMeter {
  tenantId: string;
  period: string;        // YYYY-MM
  transactions: number;  // expenses + invoices + journal entries
  llmCalls: number;
  llmTokensInput: number;
  llmTokensOutput: number;
  llmCostCents: number;
  storageBytes: number;  // receipt images
  apiCalls: number;
  bankSyncs: number;
}

export interface BillingPlan {
  id: string;
  name: string;
  monthlyPriceCents: number;
  limits: {
    transactionsPerMonth: number;
    llmCallsPerMonth: number;
    storageMB: number;
    bankAccounts: number;
    users: number;
  };
}

const PLANS: BillingPlan[] = [
  {
    id: 'free',
    name: 'Free',
    monthlyPriceCents: 0,
    limits: { transactionsPerMonth: 50, llmCallsPerMonth: 100, storageMB: 100, bankAccounts: 1, users: 1 },
  },
  {
    id: 'pro',
    name: 'Pro',
    monthlyPriceCents: 1200, // $12/mo
    limits: { transactionsPerMonth: 500, llmCallsPerMonth: 1000, storageMB: 1000, bankAccounts: 5, users: 3 },
  },
  {
    id: 'business',
    name: 'Business',
    monthlyPriceCents: 3900, // $39/mo
    limits: { transactionsPerMonth: -1, llmCallsPerMonth: 5000, storageMB: 10000, bankAccounts: 20, users: 10 },
  },
];

export function getPlan(planId: string): BillingPlan | undefined {
  return PLANS.find(p => p.id === planId);
}

export function getPlans(): BillingPlan[] {
  return PLANS;
}

export class UsageMeteringService {
  private meters: Map<string, UsageMeter> = new Map();

  private getKey(tenantId: string): string {
    const now = new Date();
    const period = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return `${tenantId}:${period}`;
  }

  private getMeter(tenantId: string): UsageMeter {
    const key = this.getKey(tenantId);
    if (!this.meters.has(key)) {
      const now = new Date();
      this.meters.set(key, {
        tenantId,
        period: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
        transactions: 0, llmCalls: 0, llmTokensInput: 0, llmTokensOutput: 0,
        llmCostCents: 0, storageBytes: 0, apiCalls: 0, bankSyncs: 0,
      });
    }
    return this.meters.get(key)!;
  }

  recordTransaction(tenantId: string): void {
    this.getMeter(tenantId).transactions++;
  }

  recordLLMCall(tenantId: string, inputTokens: number, outputTokens: number, costCents: number): void {
    const m = this.getMeter(tenantId);
    m.llmCalls++;
    m.llmTokensInput += inputTokens;
    m.llmTokensOutput += outputTokens;
    m.llmCostCents += costCents;
  }

  recordStorage(tenantId: string, bytes: number): void {
    this.getMeter(tenantId).storageBytes += bytes;
  }

  recordAPICall(tenantId: string): void {
    this.getMeter(tenantId).apiCalls++;
  }

  recordBankSync(tenantId: string): void {
    this.getMeter(tenantId).bankSyncs++;
  }

  getUsage(tenantId: string): UsageMeter {
    return this.getMeter(tenantId);
  }

  isWithinLimits(tenantId: string, planId: string): { withinLimits: boolean; exceeded: string[] } {
    const plan = getPlan(planId);
    if (!plan) return { withinLimits: false, exceeded: ['unknown_plan'] };

    const usage = this.getMeter(tenantId);
    const exceeded: string[] = [];

    if (plan.limits.transactionsPerMonth > 0 && usage.transactions >= plan.limits.transactionsPerMonth) {
      exceeded.push('transactions');
    }
    if (plan.limits.llmCallsPerMonth > 0 && usage.llmCalls >= plan.limits.llmCallsPerMonth) {
      exceeded.push('llm_calls');
    }

    return { withinLimits: exceeded.length === 0, exceeded };
  }
}
