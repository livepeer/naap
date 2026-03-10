/**
 * Service Gateway — Admin: Connector Rankings
 * GET  /api/v1/gw/admin/connectors/:id/rankings — List rankings
 * PUT  /api/v1/gw/admin/connectors/:id/rankings — Upsert rankings
 */

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';
import { getAdminContext, isErrorResponse, loadOwnedConnector } from '@/lib/gateway/admin/team-guard';
import { z } from 'zod';

type RouteContext = { params: Promise<{ id: string }> };

const rankingItemSchema = z.object({
  category: z.string(),
  modelName: z.string().optional(),
  qualityRank: z.number().int(),
  qualityScore: z.number().optional(),
  speedRank: z.number().int().optional(),
  costEfficiencyRank: z.number().int().optional(),
  totalRanked: z.number().int().optional(),
  benchmarkSource: z.string().optional(),
  benchmarkScore: z.number().optional(),
  benchmarkUrl: z.string().optional(),
  notes: z.string().optional(),
  capabilityTags: z.array(z.string()).optional(),
});

const putRankingsSchema = z.object({
  rankings: z.array(rankingItemSchema),
});

export async function GET(request: NextRequest, context: RouteContext) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { id } = await context.params;
  const connector = await loadOwnedConnector(id, ctx.teamId);
  if (!connector) {
    return errors.notFound('Connector');
  }

  const rankings = await prisma.connectorCapabilityRanking.findMany({
    where: { connectorId: id },
    orderBy: { qualityRank: 'asc' },
  });

  return success(rankings);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { id } = await context.params;
  const connector = await loadOwnedConnector(id, ctx.teamId);
  if (!connector) {
    return errors.notFound('Connector');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errors.badRequest('Invalid JSON body');
  }

  const parsed = putRankingsSchema.safeParse(body);
  if (!parsed.success) {
    return errors.validationError(
      Object.fromEntries(parsed.error.errors.map((e) => [e.path.join('.'), e.message]))
    );
  }

  const now = new Date();

  const results = await prisma.$transaction(
    parsed.data.rankings.map((r) => {
      const modelName = r.modelName ?? null;
      return prisma.connectorCapabilityRanking.upsert({
        where: {
          connectorId_category_modelName: {
            connectorId: id,
            category: r.category,
            modelName,
          },
        },
        create: {
          connectorId: id,
          category: r.category,
          modelName,
          qualityRank: r.qualityRank,
          qualityScore: r.qualityScore ?? null,
          speedRank: r.speedRank ?? null,
          costEfficiencyRank: r.costEfficiencyRank ?? null,
          totalRanked: r.totalRanked ?? 0,
          benchmarkSource: r.benchmarkSource ?? null,
          benchmarkScore: r.benchmarkScore ?? null,
          benchmarkUrl: r.benchmarkUrl ?? null,
          notes: r.notes ?? null,
          capabilityTags: r.capabilityTags ?? [],
          rankedBy: ctx.userId,
          lastRankedAt: now,
        },
        update: {
          qualityRank: r.qualityRank,
          qualityScore: r.qualityScore ?? undefined,
          speedRank: r.speedRank ?? undefined,
          costEfficiencyRank: r.costEfficiencyRank ?? undefined,
          totalRanked: r.totalRanked ?? undefined,
          benchmarkSource: r.benchmarkSource ?? undefined,
          benchmarkScore: r.benchmarkScore ?? undefined,
          benchmarkUrl: r.benchmarkUrl ?? undefined,
          notes: r.notes ?? undefined,
          capabilityTags: r.capabilityTags ?? undefined,
          rankedBy: ctx.userId,
          lastRankedAt: now,
        },
        select: { category: true, modelName: true },
      });
    })
  );

  return success({ updated: results.length, rankings: results });
}
