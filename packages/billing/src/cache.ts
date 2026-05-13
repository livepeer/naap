import type { PlanFeatures, PlanQuotas, SubscriptionStatus } from './types.js';

export interface CachedPlan {
  planId: string;
  code: string;
  status: SubscriptionStatus;
  features: PlanFeatures;
  quotas: PlanQuotas;
  currentPeriodStart: Date | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  cachedAt: number;
}

export class PlanCache {
  private store = new Map<string, CachedPlan>();
  constructor(private readonly ttlMs: number = 24 * 60 * 60 * 1000) {}

  get(accountId: string): CachedPlan | null {
    const entry = this.store.get(accountId);
    if (!entry) return null;
    if (Date.now() - entry.cachedAt > this.ttlMs) {
      this.store.delete(accountId);
      return null;
    }
    return entry;
  }

  set(accountId: string, entry: CachedPlan): void {
    this.store.set(accountId, entry);
  }

  invalidate(accountId: string): void {
    this.store.delete(accountId);
  }

  clear(): void {
    this.store.clear();
  }
}

/**
 * Singleton used across the process. Different Vercel Function instances
 * have separate caches — staleness window is bounded by TTL + the
 * webhook-driven invalidate() round-trip (≈ a few seconds in practice).
 */
export const planCache = new PlanCache();
