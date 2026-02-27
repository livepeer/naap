/**
 * Service Gateway — Admin: Plan Detail / Update / Delete
 * GET    /api/v1/gw/admin/plans/:id
 * PUT    /api/v1/gw/admin/plans/:id
 * DELETE /api/v1/gw/admin/plans/:id
 */

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';
import { getAdminContext, isErrorResponse } from '@/lib/gateway/admin/team-guard';
import { z } from 'zod';

const updatePlanSchema = z.object({
  displayName: z.string().min(1).max(128).optional(),
  rateLimit: z.number().int().min(1).optional(),
  dailyQuota: z.number().int().min(1).nullable().optional(),
  monthlyQuota: z.number().int().min(1).nullable().optional(),
  maxRequestSize: z.number().int().min(0).optional(),
  maxResponseSize: z.number().int().min(0).optional(),
  burstLimit: z.number().int().min(1).nullable().optional(),
  allowedConnectors: z.array(z.string()).optional(),
});

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: NextRequest, context: RouteContext) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { id } = await context.params;
  const plan = await prisma.gatewayPlan.findFirst({
    where: { id, teamId: ctx.teamId },
    include: { apiKeys: { select: { id: true, name: true, status: true } } },
  });

  if (!plan) {
    return errors.notFound('Plan');
  }

  return success({
    ...plan,
    activeKeyCount: plan.apiKeys.filter((k) => k.status === 'active').length,
  });
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { id } = await context.params;
  const existing = await prisma.gatewayPlan.findFirst({
    where: { id, teamId: ctx.teamId },
  });
  if (!existing) {
    return errors.notFound('Plan');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errors.badRequest('Invalid JSON body');
  }

  const parsed = updatePlanSchema.safeParse(body);
  if (!parsed.success) {
    return errors.validationError(
      Object.fromEntries(
        parsed.error.errors.map((e) => [e.path.join('.'), e.message])
      )
    );
  }

  const plan = await prisma.gatewayPlan.update({
    where: { id, teamId: ctx.teamId },
    data: parsed.data,
  });

  return success(plan);
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { id } = await context.params;
  const existing = await prisma.gatewayPlan.findFirst({
    where: { id, teamId: ctx.teamId },
    include: { apiKeys: { where: { status: 'active' } } },
  });

  if (!existing) {
    return errors.notFound('Plan');
  }

  // Prevent deletion if active keys reference this plan
  if (existing.apiKeys.length > 0) {
    return errors.conflict(
      `Cannot delete plan: ${existing.apiKeys.length} active API key(s) are using it. Revoke or reassign them first.`
    );
  }

  await prisma.gatewayPlan.delete({ where: { id } });

  return success({ id, deleted: true });
}
