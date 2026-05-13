import { prisma } from '@naap/database';
import { resolveAccountId } from './account-resolver.js';
import { getCurrentPlanStrict, getCurrentPlan } from './plans.js';
import type { UsageDimension } from './types.js';

export interface QuotaCheck {
  allowed: boolean;
  used: number;
  limit: number;     // -1 = unlimited
  remaining: number; // Infinity when unlimited
}

function periodStartOf(d: Date | null): Date {
  if (d) return d;
  // Free tier with no current period: bucket by calendar month start UTC
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export async function checkQuota(tenantId: string, dim: UsageDimension): Promise<QuotaCheck> {
  try {
    const cur = await getCurrentPlanStrict(tenantId);
    const limit = cur.plan.quotas[dim];
    const used = cur.usage[dim].used;
    if (limit === -1) {
      return { allowed: true, used, limit: -1, remaining: Number.POSITIVE_INFINITY };
    }
    return { allowed: used < limit, used, limit, remaining: Math.max(0, limit - used) };
  } catch (err) {
    console.warn('[billing] checkQuota failed open:', err);
    return { allowed: true, used: 0, limit: -1, remaining: Number.POSITIVE_INFINITY };
  }
}

export async function incrementUsage(tenantId: string, dim: UsageDimension, n: number = 1): Promise<void> {
  try {
    const accountId = await resolveAccountId(tenantId);
    const cur = await getCurrentPlan(tenantId);
    const periodStart = periodStartOf(
      cur.periodEnd ? new Date(cur.periodEnd.getTime() - 30 * 86400_000) : null,
    );
    await prisma.billUsageCounter.upsert({
      where: { accountId_dimension_periodStart: { accountId, dimension: dim, periodStart } },
      create: { accountId, dimension: dim, periodStart, count: n },
      update: { count: { increment: n } },
    });
  } catch (err) {
    console.warn('[billing] incrementUsage swallowed error:', err);
  }
}

export async function getUsage(tenantId: string, dim: UsageDimension): Promise<number> {
  try {
    const cur = await getCurrentPlan(tenantId);
    return cur.usage[dim].used;
  } catch (err) {
    console.warn('[billing] getUsage failed:', err);
    return 0;
  }
}
