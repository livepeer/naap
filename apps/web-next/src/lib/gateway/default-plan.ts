/**
 * Service Gateway — Default Plan
 *
 * Every scope (team or personal) has an implicit "default" plan that
 * applies to API keys with no explicit plan assigned.  The plan is
 * auto-created on first access with sensible defaults and is fully
 * editable by the admin — but can never be deleted.
 *
 * Well-known name: "default"
 */

import { prisma } from '@/lib/db';
import { parseScope } from './scope';

export const DEFAULT_PLAN_NAME = 'default';

const DEFAULT_PLAN_SEED = {
  name: DEFAULT_PLAN_NAME,
  displayName: 'Default',
  rateLimit: 100,
  dailyQuota: 10_000,
  monthlyQuota: 100_000,
  maxRequestSize: 1_048_576,
  maxResponseSize: 4_194_304,
};

export interface DefaultPlanLimits {
  rateLimit: number;
  dailyQuota: number | null;
  monthlyQuota: number | null;
  maxRequestSize: number;
}

/**
 * Resolve the default plan for a scope, creating it if it doesn't exist.
 * Uses upsert to avoid race conditions when two requests trigger creation.
 */
export async function getOrCreateDefaultPlan(scopeId: string): Promise<DefaultPlanLimits> {
  const scope = parseScope(scopeId);
  const ownerData = scope.type === 'personal'
    ? { ownerUserId: scope.userId }
    : { teamId: scope.teamId };

  const whereUnique = scope.type === 'personal'
    ? { ownerUserId_name: { ownerUserId: scope.userId, name: DEFAULT_PLAN_NAME } }
    : { teamId_name: { teamId: scope.teamId, name: DEFAULT_PLAN_NAME } };

  const plan = await prisma.gatewayPlan.upsert({
    where: whereUnique,
    create: { ...ownerData, ...DEFAULT_PLAN_SEED },
    update: {},
    select: {
      rateLimit: true,
      dailyQuota: true,
      monthlyQuota: true,
      maxRequestSize: true,
    },
  });

  return plan;
}

/**
 * Check if a plan is the default plan (by name).
 */
export function isDefaultPlan(planName: string): boolean {
  return planName === DEFAULT_PLAN_NAME;
}
