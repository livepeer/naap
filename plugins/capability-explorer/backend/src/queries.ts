/**
 * Capability Explorer — CapabilityQuery CRUD
 *
 * Mirrors the DiscoveryPlan CRUD from orchestrator-leaderboard/plans.ts.
 * User-scoped saved queries that filter the global capability dataset.
 */

import { prisma } from '@naap/database';
import type {
  CapabilityQueryRecord,
  CreateCapabilityQueryInput,
  UpdateCapabilityQueryInput,
  CapabilityConnection,
  ListCapabilitiesParams,
} from './types.js';
import { getCapabilities, filterCapabilities } from './aggregator.js';

export type QueryScope = { teamId?: string; ownerUserId?: string };

function scopeWhere(scope: QueryScope) {
  const conditions: Record<string, string>[] = [];
  if (scope.teamId) conditions.push({ teamId: scope.teamId });
  if (scope.ownerUserId) conditions.push({ ownerUserId: scope.ownerUserId });
  if (conditions.length === 0) return {};
  if (conditions.length === 1) return conditions[0];
  return { OR: conditions };
}

function toRecord(row: Record<string, unknown>): CapabilityQueryRecord {
  return {
    id: row.id as string,
    name: row.name as string,
    slug: row.slug as string,
    teamId: (row.teamId as string) ?? null,
    ownerUserId: (row.ownerUserId as string) ?? null,
    category: (row.category as string) ?? null,
    search: (row.search as string) ?? null,
    minGpuCount: (row.minGpuCount as number) ?? null,
    maxPriceUsd: (row.maxPriceUsd as number) ?? null,
    minCapacity: (row.minCapacity as number) ?? null,
    sortBy: (row.sortBy as string) ?? null,
    sortOrder: (row.sortOrder as string) ?? null,
    limit: row.limit as number,
    enabled: row.enabled as boolean,
    createdAt: (row.createdAt as Date).toISOString(),
    updatedAt: (row.updatedAt as Date).toISOString(),
  };
}

export async function createQuery(
  input: CreateCapabilityQueryInput,
  scope: QueryScope,
): Promise<CapabilityQueryRecord> {
  const row = await prisma.capabilityQuery.create({
    data: {
      name: input.name,
      slug: input.slug,
      category: input.category ?? null,
      search: input.search ?? null,
      minGpuCount: input.minGpuCount ?? null,
      maxPriceUsd: input.maxPriceUsd ?? null,
      minCapacity: input.minCapacity ?? null,
      sortBy: input.sortBy ?? null,
      sortOrder: input.sortOrder ?? null,
      limit: input.limit ?? 50,
      teamId: scope.teamId ?? null,
      ownerUserId: scope.ownerUserId ?? null,
    },
  });
  return toRecord(row as unknown as Record<string, unknown>);
}

export async function listQueries(scope: QueryScope): Promise<CapabilityQueryRecord[]> {
  const rows = await prisma.capabilityQuery.findMany({
    where: scopeWhere(scope),
    orderBy: { createdAt: 'desc' },
  });
  return rows.map((r) => toRecord(r as unknown as Record<string, unknown>));
}

export async function getQuery(
  id: string,
  scope: QueryScope,
): Promise<CapabilityQueryRecord | null> {
  const row = await prisma.capabilityQuery.findFirst({
    where: { id, ...scopeWhere(scope) },
  });
  return row ? toRecord(row as unknown as Record<string, unknown>) : null;
}

export async function getQueryBySlug(
  slug: string,
  scope: QueryScope,
): Promise<CapabilityQueryRecord | null> {
  const row = await prisma.capabilityQuery.findFirst({
    where: { slug, ...scopeWhere(scope) },
  });
  return row ? toRecord(row as unknown as Record<string, unknown>) : null;
}

export async function updateQuery(
  id: string,
  input: UpdateCapabilityQueryInput,
  scope: QueryScope,
): Promise<CapabilityQueryRecord | null> {
  const existing = await prisma.capabilityQuery.findFirst({
    where: { id, ...scopeWhere(scope) },
  });
  if (!existing) return null;

  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.category !== undefined) data.category = input.category;
  if (input.search !== undefined) data.search = input.search;
  if (input.minGpuCount !== undefined) data.minGpuCount = input.minGpuCount;
  if (input.maxPriceUsd !== undefined) data.maxPriceUsd = input.maxPriceUsd;
  if (input.minCapacity !== undefined) data.minCapacity = input.minCapacity;
  if (input.sortBy !== undefined) data.sortBy = input.sortBy;
  if (input.sortOrder !== undefined) data.sortOrder = input.sortOrder;
  if (input.limit !== undefined) data.limit = input.limit;
  if (input.enabled !== undefined) data.enabled = input.enabled;

  const row = await prisma.capabilityQuery.update({
    where: { id },
    data,
  });
  return toRecord(row as unknown as Record<string, unknown>);
}

export async function deleteQuery(
  id: string,
  scope: QueryScope,
): Promise<boolean> {
  const existing = await prisma.capabilityQuery.findFirst({
    where: { id, ...scopeWhere(scope) },
  });
  if (!existing) return false;
  await prisma.capabilityQuery.delete({ where: { id } });
  return true;
}

/**
 * Evaluate a saved query against the warm capability cache.
 * Returns filtered results without touching ClickHouse/HuggingFace.
 */
export async function evaluateQuery(
  query: CapabilityQueryRecord,
): Promise<CapabilityConnection> {
  const all = await getCapabilities();

  const params: ListCapabilitiesParams = {
    category: query.category as ListCapabilitiesParams['category'],
    search: query.search ?? undefined,
    minGpuCount: query.minGpuCount ?? undefined,
    maxPriceUsd: query.maxPriceUsd ?? undefined,
    minCapacity: query.minCapacity ?? undefined,
    sortBy: (query.sortBy as ListCapabilitiesParams['sortBy']) ?? undefined,
    sortOrder: (query.sortOrder as ListCapabilitiesParams['sortOrder']) ?? undefined,
    limit: query.limit,
    offset: 0,
  };

  return filterCapabilities(all, params);
}
