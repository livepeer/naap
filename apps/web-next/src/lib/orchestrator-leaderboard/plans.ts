/**
 * Orchestrator Leaderboard — Discovery Plan CRUD
 *
 * Provides create, list, get, update, delete operations for DiscoveryPlan
 * records stored in Postgres.
 *
 * Visibility model:
 *   - "public"   → visible to ALL signed-in users (admin-created defaults).
 *   - "team"     → visible to team members (future).
 *   - "personal" → visible only to the owning user.
 *
 * Read queries include public plans + the caller's own scope.
 * Mutations on public plans require isAdmin.
 */

import { prisma } from '@/lib/db';
import type {
  CreatePlanInput,
  UpdatePlanInput,
  DiscoveryPlan,
  LeaderboardFilters,
  SLAWeights,
  PlanVisibility,
} from './types';

export type PlanScope = { teamId?: string; ownerUserId?: string; isAdmin?: boolean };

/**
 * Build a where clause that matches the caller's own plans (by teamId/ownerUserId)
 * OR any public plans.
 */
function readScopeWhere(scope: PlanScope) {
  const conditions: Record<string, unknown>[] = [{ visibility: 'public' }];
  if (scope.teamId) conditions.push({ teamId: scope.teamId });
  if (scope.ownerUserId) conditions.push({ ownerUserId: scope.ownerUserId });
  return { OR: conditions };
}

/**
 * Build a where clause that matches ONLY the caller's own plans (for mutations).
 */
function writeScopeWhere(scope: PlanScope) {
  const conditions: Record<string, string>[] = [];
  if (scope.teamId) conditions.push({ teamId: scope.teamId });
  if (scope.ownerUserId) conditions.push({ ownerUserId: scope.ownerUserId });
  if (conditions.length === 0) return {};
  if (conditions.length === 1) return conditions[0];
  return { OR: conditions };
}

function toPlan(row: Record<string, unknown>): DiscoveryPlan {
  return {
    id: row.id as string,
    billingPlanId: row.billingPlanId as string,
    name: row.name as string,
    description: (row.description as string) ?? null,
    visibility: (row.visibility as PlanVisibility) ?? 'personal',
    teamId: (row.teamId as string) ?? null,
    ownerUserId: (row.ownerUserId as string) ?? null,
    capabilities: row.capabilities as string[],
    topN: row.topN as number,
    slaWeights: (row.slaWeights as SLAWeights) ?? null,
    slaMinScore: (row.slaMinScore as number) ?? null,
    sortBy: (row.sortBy as DiscoveryPlan['sortBy']) ?? null,
    filters: (row.filters as LeaderboardFilters) ?? null,
    enabled: row.enabled as boolean,
    createdAt: (row.createdAt as Date).toISOString(),
    updatedAt: (row.updatedAt as Date).toISOString(),
  };
}

export async function createPlan(
  input: CreatePlanInput,
  scope: PlanScope,
): Promise<DiscoveryPlan> {
  const row = await prisma.discoveryPlan.create({
    data: {
      billingPlanId: input.billingPlanId,
      name: input.name,
      description: input.description ?? undefined,
      visibility: 'personal',
      capabilities: input.capabilities,
      topN: input.topN ?? 10,
      slaWeights: input.slaWeights ?? undefined,
      slaMinScore: input.slaMinScore ?? undefined,
      sortBy: input.sortBy ?? undefined,
      filters: input.filters ?? undefined,
      teamId: scope.teamId ?? undefined,
      ownerUserId: scope.ownerUserId ?? undefined,
    },
  });
  return toPlan(row as unknown as Record<string, unknown>);
}

export async function listPlans(scope: PlanScope): Promise<DiscoveryPlan[]> {
  const rows = await prisma.discoveryPlan.findMany({
    where: readScopeWhere(scope),
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => toPlan(r as unknown as Record<string, unknown>));
}

export async function getPlan(
  id: string,
  scope: PlanScope,
): Promise<DiscoveryPlan | null> {
  const row = await prisma.discoveryPlan.findFirst({
    where: { id, ...readScopeWhere(scope) },
  });
  return row ? toPlan(row as unknown as Record<string, unknown>) : null;
}

/**
 * Returns 'forbidden' if the caller is not allowed to mutate the plan.
 */
export async function updatePlan(
  id: string,
  input: UpdatePlanInput,
  scope: PlanScope,
): Promise<DiscoveryPlan | null | 'forbidden'> {
  const existing = await getPlan(id, scope);
  if (!existing) return null;
  if (existing.visibility === 'public' && !scope.isAdmin) return 'forbidden';

  const mutationWhere = existing.visibility === 'public'
    ? { id }
    : { id, ...writeScopeWhere(scope) };

  const result = await prisma.discoveryPlan.updateMany({
    where: mutationWhere,
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.description !== undefined && { description: input.description }),
      ...(input.capabilities !== undefined && { capabilities: input.capabilities }),
      ...(input.topN !== undefined && { topN: input.topN }),
      ...(input.slaWeights !== undefined && { slaWeights: input.slaWeights }),
      ...(input.slaMinScore !== undefined && { slaMinScore: input.slaMinScore }),
      ...(input.sortBy !== undefined && { sortBy: input.sortBy }),
      ...(input.filters !== undefined && { filters: input.filters }),
    },
  });
  if (result.count === 0) return null;
  return getPlan(id, scope);
}

/**
 * Returns 'forbidden' if the caller is not allowed to delete the plan.
 */
export async function deletePlan(
  id: string,
  scope: PlanScope,
): Promise<boolean | 'forbidden'> {
  const existing = await getPlan(id, scope);
  if (!existing) return false;
  if (existing.visibility === 'public' && !scope.isAdmin) return 'forbidden';

  const mutationWhere = existing.visibility === 'public'
    ? { id }
    : { id, ...writeScopeWhere(scope) };

  const result = await prisma.discoveryPlan.deleteMany({
    where: mutationWhere,
  });
  return result.count > 0;
}

export async function listEnabledPlans(): Promise<DiscoveryPlan[]> {
  const rows = await prisma.discoveryPlan.findMany({
    where: { enabled: true },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => toPlan(r as unknown as Record<string, unknown>));
}
