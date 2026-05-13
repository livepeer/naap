import { prisma } from '@naap/database';
import { planCache, type CachedPlan } from './cache.js';
import { resolveAccountId } from './account-resolver.js';
import type { PlanFeatures, PlanQuotas, SubscriptionStatus, UsageDimension } from './types.js';

const ALL_DIMS: UsageDimension[] = [
  'expenses_created', 'ocr_scans', 'ai_messages', 'invoices_sent', 'bank_connections',
];

const SYNTHETIC_FREE: Omit<CachedPlan, 'cachedAt'> = {
  planId: 'synthetic-free',
  code: 'free',
  status: 'active',
  features: { telegram_bot: false, tax_package_generation: false, multi_user_teams: false },
  quotas: { expenses_created: 50, ocr_scans: 10, ai_messages: 100, invoices_sent: 5, bank_connections: 0 },
  currentPeriodStart: null,
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
};

export interface CurrentPlan {
  plan: { id: string; code: string; name: string; priceCents: number; features: PlanFeatures; quotas: PlanQuotas };
  status: SubscriptionStatus;
  periodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  usage: Record<UsageDimension, { used: number; limit: number }>;
}

export function _resetCacheForTests(): void {
  planCache.clear();
}

async function loadCachedPlan(accountId: string): Promise<CachedPlan> {
  const hit = planCache.get(accountId);
  if (hit) return hit;
  const sub = await prisma.billSubscription.findUnique({
    where: { accountId },
    include: { plan: true },
  });
  if (!sub) {
    const free = await prisma.billPlan.findFirst({ where: { code: 'free', isActive: true } });
    const entry: CachedPlan = free
      ? {
          planId: free.id,
          code: free.code,
          status: 'active',
          features: free.features as unknown as PlanFeatures,
          quotas: free.quotas as unknown as PlanQuotas,
          currentPeriodStart: null,
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          cachedAt: Date.now(),
        }
      : { ...SYNTHETIC_FREE, cachedAt: Date.now() };
    planCache.set(accountId, entry);
    return entry;
  }
  const entry: CachedPlan = {
    planId: sub.plan.id,
    code: sub.plan.code,
    status: sub.status as SubscriptionStatus,
    features: sub.plan.features as unknown as PlanFeatures,
    quotas: sub.plan.quotas as unknown as PlanQuotas,
    currentPeriodStart: sub.currentPeriodStart,
    currentPeriodEnd: sub.currentPeriodEnd,
    cancelAtPeriodEnd: sub.cancelAtPeriodEnd,
    cachedAt: Date.now(),
  };
  planCache.set(accountId, entry);
  return entry;
}

async function loadUsage(accountId: string, periodStart: Date | null): Promise<Record<UsageDimension, number>> {
  const usage: Record<UsageDimension, number> = {
    expenses_created: 0, ocr_scans: 0, ai_messages: 0, invoices_sent: 0, bank_connections: 0,
  };
  if (!periodStart) return usage;
  try {
    const rows = await prisma.billUsageCounter.findMany({
      where: { accountId, periodStart },
    });
    for (const r of rows) {
      if ((ALL_DIMS as string[]).includes(r.dimension)) {
        usage[r.dimension as UsageDimension] = r.count;
      }
    }
  } catch (err) {
    console.warn('[billing] loadUsage failed (returning zeros):', err);
  }
  return usage;
}

/**
 * Internal — throws on DB errors. Used by canUseFeature/checkQuota so
 * they can fail open with intent-specific logic (return true).
 */
export async function getCurrentPlanStrict(tenantId: string): Promise<CurrentPlan> {
  const accountId = await resolveAccountId(tenantId);
  const cached = await loadCachedPlan(accountId);
  const counts = await loadUsage(accountId, cached.currentPeriodStart);

  const usage: CurrentPlan['usage'] = {
    expenses_created: { used: counts.expenses_created, limit: cached.quotas.expenses_created },
    ocr_scans: { used: counts.ocr_scans, limit: cached.quotas.ocr_scans },
    ai_messages: { used: counts.ai_messages, limit: cached.quotas.ai_messages },
    invoices_sent: { used: counts.invoices_sent, limit: cached.quotas.invoices_sent },
    bank_connections: { used: counts.bank_connections, limit: cached.quotas.bank_connections },
  };

  return {
    plan: { id: cached.planId, code: cached.code, name: cached.code, priceCents: 0, features: cached.features, quotas: cached.quotas },
    status: cached.status,
    periodEnd: cached.currentPeriodEnd,
    cancelAtPeriodEnd: cached.cancelAtPeriodEnd,
    usage,
  };
}

/**
 * Public — fails open on DB errors. /billing page renders Free
 * fallback rather than breaking. Use getCurrentPlanStrict in
 * contexts that want to surface errors (e.g., admin ops view).
 */
export async function getCurrentPlan(tenantId: string): Promise<CurrentPlan> {
  try {
    return await getCurrentPlanStrict(tenantId);
  } catch (err) {
    console.warn('[billing] getCurrentPlan failed, returning Free fallback:', err);
    return {
      plan: {
        id: SYNTHETIC_FREE.planId, code: SYNTHETIC_FREE.code, name: SYNTHETIC_FREE.code, priceCents: 0,
        features: SYNTHETIC_FREE.features, quotas: SYNTHETIC_FREE.quotas,
      },
      status: SYNTHETIC_FREE.status,
      periodEnd: null,
      cancelAtPeriodEnd: false,
      usage: {
        expenses_created: { used: 0, limit: SYNTHETIC_FREE.quotas.expenses_created },
        ocr_scans: { used: 0, limit: SYNTHETIC_FREE.quotas.ocr_scans },
        ai_messages: { used: 0, limit: SYNTHETIC_FREE.quotas.ai_messages },
        invoices_sent: { used: 0, limit: SYNTHETIC_FREE.quotas.invoices_sent },
        bank_connections: { used: 0, limit: SYNTHETIC_FREE.quotas.bank_connections },
      },
    };
  }
}
