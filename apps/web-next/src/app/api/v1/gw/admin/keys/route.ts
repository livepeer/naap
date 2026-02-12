/**
 * Service Gateway — Admin: API Key List / Create
 * GET  /api/v1/gw/admin/keys   — List API keys (team-scoped)
 * POST /api/v1/gw/admin/keys   — Create new API key (returns raw key ONCE)
 */

import { randomBytes, createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success, successPaginated, errors, parsePagination } from '@/lib/api/response';
import { getAdminContext, isErrorResponse, loadConnector } from '@/lib/gateway/admin/team-guard';
import { z } from 'zod';

const createKeySchema = z.object({
  name: z.string().min(1).max(128),
  connectorId: z.string().uuid().optional(),
  planId: z.string().uuid().optional(),
  allowedEndpoints: z.array(z.string()).default([]),
  allowedIPs: z.array(z.string()).default([]),
  expiresAt: z.string().datetime().optional(),
});

export async function GET(request: NextRequest) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { searchParams } = request.nextUrl;
  const { page, pageSize, skip } = parsePagination(searchParams);
  const connectorId = searchParams.get('connectorId');
  const status = searchParams.get('status');

  const where = {
    teamId: ctx.teamId,
    ...(connectorId ? { connectorId } : {}),
    ...(status ? { status } : {}),
  };

  const [keys, total] = await Promise.all([
    prisma.gatewayApiKey.findMany({
      where,
      include: {
        connector: { select: { id: true, slug: true, displayName: true } },
        plan: { select: { id: true, name: true, displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.gatewayApiKey.count({ where }),
  ]);

  // Never return keyHash in list — only keyPrefix for display
  const data = keys.map(({ keyHash, ...rest }) => rest);

  return successPaginated(data, { page, pageSize, total });
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

  const parsed = createKeySchema.safeParse(body);
  if (!parsed.success) {
    return errors.validationError(
      Object.fromEntries(
        parsed.error.errors.map((e) => [e.path.join('.'), e.message])
      )
    );
  }

  // If connectorId specified, verify it belongs to this team
  if (parsed.data.connectorId) {
    const connector = await loadConnector(parsed.data.connectorId, ctx.teamId);
    if (!connector) {
      return errors.notFound('Connector');
    }
  }

  // If planId specified, verify it belongs to this team
  if (parsed.data.planId) {
    const plan = await prisma.gatewayPlan.findFirst({
      where: { id: parsed.data.planId, teamId: ctx.teamId },
    });
    if (!plan) {
      return errors.notFound('Plan');
    }
  }

  // Generate key: gw_ + 32 random bytes hex = gw_<64 chars>
  const rawKey = `gw_${randomBytes(32).toString('hex')}`;
  const keyHash = createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 11); // "gw_" + first 8 hex chars

  const apiKey = await prisma.gatewayApiKey.create({
    data: {
      teamId: ctx.teamId,
      createdBy: ctx.userId,
      name: parsed.data.name,
      keyHash,
      keyPrefix,
      connectorId: parsed.data.connectorId || null,
      planId: parsed.data.planId || null,
      allowedEndpoints: parsed.data.allowedEndpoints,
      allowedIPs: parsed.data.allowedIPs,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
    },
    include: {
      connector: { select: { id: true, slug: true, displayName: true } },
      plan: { select: { id: true, name: true, displayName: true } },
    },
  });

  // Return the raw key ONCE — it cannot be retrieved again
  const { keyHash: _, ...safeKey } = apiKey;
  return success({
    ...safeKey,
    rawKey, // ⚠️ Only returned on creation — never again
  });
}
