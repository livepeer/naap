/**
 * Service Gateway — Admin: Plan List / Create
 * GET  /api/v1/gw/admin/plans   — List plans (scope-aware)
 * POST /api/v1/gw/admin/plans   — Create new plan
 */

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';
import { getAdminContext, isErrorResponse } from '@/lib/gateway/admin/team-guard';
import { z } from 'zod';

const createPlanSchema = z.object({
  name: z.string().min(1).max(64).regex(/^[a-z0-9-]+$/, 'Plan name must be lowercase alphanumeric with hyphens'),
  displayName: z.string().min(1).max(128),
  rateLimit: z.number().int().min(1).default(100),
  dailyQuota: z.number().int().min(1).optional(),
  monthlyQuota: z.number().int().min(1).optional(),
  maxRequestSize: z.number().int().min(0).default(1_048_576),
  maxResponseSize: z.number().int().min(0).default(4_194_304),
  burstLimit: z.number().int().min(1).optional(),
  allowedConnectors: z.array(z.string()).default([]),
});

function ownerWhere(ctx: { teamId: string; userId: string; isPersonal: boolean }) {
  if (ctx.isPersonal) return { ownerUserId: ctx.userId };
  return { teamId: ctx.teamId };
}


export async function GET(request: NextRequest) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const plans = await prisma.gatewayPlan.findMany({
    where: ownerWhere(ctx),
    include: { apiKeys: { select: { id: true, status: true } } },
    orderBy: { createdAt: 'desc' },
  });

  const data = plans.map((p) => ({
    ...p,
    activeKeyCount: p.apiKeys.filter((k) => k.status === 'active').length,
    apiKeys: undefined,
  }));

  return success(data);
}

export async function POST(request: NextRequest) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errors.badRequest('Invalid JSON body');
  }

  const parsed = createPlanSchema.safeParse(body);
  if (!parsed.success) {
    return errors.validationError(
      Object.fromEntries(
        parsed.error.errors.map((e) => [e.path.join('.'), e.message])
      )
    );
  }

  const existing = ctx.isPersonal
    ? await prisma.gatewayPlan.findUnique({
        where: { ownerUserId_name: { ownerUserId: ctx.userId, name: parsed.data.name } },
      })
    : await prisma.gatewayPlan.findUnique({
        where: { teamId_name: { teamId: ctx.teamId, name: parsed.data.name } },
      });
  if (existing) {
    return errors.conflict(`Plan "${parsed.data.name}" already exists`);
  }

  const ownerData = ctx.isPersonal
    ? { ownerUserId: ctx.userId }
    : { teamId: ctx.teamId };

  const plan = await prisma.gatewayPlan.create({
    data: {
      ...ownerData,
      ...parsed.data,
    },
  });

  return success(plan);
}
