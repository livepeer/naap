/**
 * Orchestrator Leaderboard — Discovery Plan CRUD
 *
 * Provides create, list, get, update, delete operations for DiscoveryPlan
 * records stored in Postgres. Plans are scoped by teamId or ownerUserId
 * so callers only see their own plans.
 */

import { prisma } from '@/lib/db';
import type {
  CreatePlanInput,
  UpdatePlanInput,
  DiscoveryPlan,
  LeaderboardFilters,
  SLAWeights,
} from './types';

type PlanScope = { teamId?: string; ownerUserId?: string };

function scopeWhere(scope: PlanScope) {
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
    where: scopeWhere(scope),
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => toPlan(r as unknown as Record<string, unknown>));
}

export async function getPlan(
  id: string,
  scope: PlanScope,
): Promise<DiscoveryPlan | null> {
  const row = await prisma.discoveryPlan.findFirst({
    where: { id, ...scopeWhere(scope) },
  });
  return row ? toPlan(row as unknown as Record<string, unknown>) : null;
}

export async function updatePlan(
  id: string,
  input: UpdatePlanInput,
  scope: PlanScope,
): Promise<DiscoveryPlan | null> {
  const existing = await prisma.discoveryPlan.findFirst({
    where: { id, ...scopeWhere(scope) },
  });
  if (!existing) return null;

  const row = await prisma.discoveryPlan.update({
    where: { id },
    data: {
      ...(input.name !== undefined && { name: input.name }),
      ...(input.capabilities !== undefined && { capabilities: input.capabilities }),
      ...(input.topN !== undefined && { topN: input.topN }),
      ...(input.slaWeights !== undefined && { slaWeights: input.slaWeights ?? undefined }),
      ...(input.slaMinScore !== undefined && { slaMinScore: input.slaMinScore }),
      ...(input.sortBy !== undefined && { sortBy: input.sortBy }),
      ...(input.filters !== undefined && { filters: input.filters ?? undefined }),
    },
  });
  return toPlan(row as unknown as Record<string, unknown>);
}

export async function deletePlan(
  id: string,
  scope: PlanScope,
): Promise<boolean> {
  const existing = await prisma.discoveryPlan.findFirst({
    where: { id, ...scopeWhere(scope) },
  });
  if (!existing) return false;
  await prisma.discoveryPlan.delete({ where: { id } });
  return true;
}

export async function listEnabledPlans(): Promise<DiscoveryPlan[]> {
  const rows = await prisma.discoveryPlan.findMany({
    where: { enabled: true },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((r) => toPlan(r as unknown as Record<string, unknown>));
}
