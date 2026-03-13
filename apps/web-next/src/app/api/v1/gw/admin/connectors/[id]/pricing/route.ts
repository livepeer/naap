/**
 * Service Gateway — Admin: Connector Pricing
 * GET /api/v1/gw/admin/connectors/:id/pricing   — Get pricing config
 * PUT /api/v1/gw/admin/connectors/:id/pricing   — Upsert pricing config
 */

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';
import { getAdminContext, isErrorResponse, loadOwnedConnector } from '@/lib/gateway/admin/team-guard';
import { z } from 'zod';

type RouteContext = { params: Promise<{ id: string }> };

const volumeTierSchema = z.object({
  minUnits: z.number(),
  costPerUnit: z.number(),
});

const featurePricingSchema = z.object({
  feature: z.string(),
  costPerUnit: z.number(),
  unit: z.string(),
});

const putPricingSchema = z.object({
  upstreamCostPerUnit: z.number().optional(),
  upstreamUnit: z.string().optional(),
  upstreamNotes: z.string().optional(),
  costPerUnit: z.number().default(0),
  unit: z.string().default('request'),
  currency: z.string().default('USD'),
  billingModel: z.string().default('per-unit'),
  volumeTiers: z.array(volumeTierSchema).default([]),
  featurePricing: z.array(featurePricingSchema).default([]),
  freeQuota: z.number().int().optional(),
});

export async function GET(request: NextRequest, context: RouteContext) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { id } = await context.params;
  const connector = await loadOwnedConnector(id, ctx.teamId);
  if (!connector) {
    return errors.notFound('Connector');
  }

  const pricing = await prisma.connectorPricing.findUnique({
    where: { connectorId: id },
  });

  return success(pricing);
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

  const parsed = putPricingSchema.safeParse(body);
  if (!parsed.success) {
    return errors.validationError(
      Object.fromEntries(parsed.error.errors.map((e) => [e.path.join('.'), e.message]))
    );
  }

  const data = parsed.data;

  const pricing = await prisma.connectorPricing.upsert({
    where: { connectorId: id },
    create: {
      connectorId: id,
      upstreamCostPerUnit: data.upstreamCostPerUnit ?? null,
      upstreamUnit: data.upstreamUnit ?? null,
      upstreamNotes: data.upstreamNotes ?? null,
      costPerUnit: data.costPerUnit,
      unit: data.unit,
      currency: data.currency,
      billingModel: data.billingModel,
      volumeTiers: data.volumeTiers as object[],
      featurePricing: data.featurePricing as object[],
      freeQuota: data.freeQuota ?? null,
      updatedBy: ctx.userId,
    },
    update: {
      upstreamCostPerUnit: data.upstreamCostPerUnit ?? undefined,
      upstreamUnit: data.upstreamUnit ?? undefined,
      upstreamNotes: data.upstreamNotes ?? undefined,
      costPerUnit: data.costPerUnit,
      unit: data.unit,
      currency: data.currency,
      billingModel: data.billingModel,
      volumeTiers: data.volumeTiers as object[],
      featurePricing: data.featurePricing as object[],
      freeQuota: data.freeQuota ?? undefined,
      updatedBy: ctx.userId,
    },
  });

  return success(pricing);
}
