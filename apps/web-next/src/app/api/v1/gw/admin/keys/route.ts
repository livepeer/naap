/**
 * Service Gateway — Admin: API Key List / Create
 * GET  /api/v1/gw/admin/keys   — List API keys (scope-aware)
 * POST /api/v1/gw/admin/keys   — Create new API key (returns raw key ONCE)
 */

export const runtime = 'nodejs';

import { randomBytes, createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success, successPaginated, errors, parsePagination } from '@/lib/api/response';
import { getAdminContext, isErrorResponse, loadConnector } from '@/lib/gateway/admin/team-guard';
import { logAudit } from '@/lib/gateway/admin/audit';
import { z } from 'zod';

const IP_V4 = /^(\d{1,3}\.){3}\d{1,3}$/;
const CIDR_V4 = /^(\d{1,3}\.){3}\d{1,3}\/\d{1,2}$/;
const IP_V6 = /^[0-9a-fA-F:]+$/;
const CIDR_V6 = /^[0-9a-fA-F:]+\/\d{1,3}$/;

function isValidIPOrCIDR(value: string): boolean {
  return IP_V4.test(value) || CIDR_V4.test(value) || IP_V6.test(value) || CIDR_V6.test(value);
}

const createKeySchema = z.object({
  name: z.string().min(1).max(128),
  connectorId: z.string().uuid().optional(),
  planId: z.string().uuid().optional(),
  allowedEndpoints: z.array(z.string()).default([]),
  allowedIPs: z.array(
    z.string().refine(isValidIPOrCIDR, { message: 'Must be a valid IPv4, IPv6, or CIDR range' })
  ).default([]),
  expiresAt: z.string().datetime().optional(),
});

function ownerWhere(ctx: { teamId: string; userId: string; isPersonal: boolean }) {
  if (ctx.isPersonal) return { ownerUserId: ctx.userId };
  return { teamId: ctx.teamId };
}

export async function GET(request: NextRequest) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { searchParams } = request.nextUrl;
  const { page, pageSize, skip } = parsePagination(searchParams);

  const listQuerySchema = z.object({
    connectorId: z.string().uuid().optional(),
    status: z.enum(['active', 'revoked', 'expired']).optional(),
  });

  const queryParsed = listQuerySchema.safeParse({
    connectorId: searchParams.get('connectorId') ?? undefined,
    status: searchParams.get('status') ?? undefined,
  });

  if (!queryParsed.success) {
    return errors.validationError(
      Object.fromEntries(queryParsed.error.errors.map((e) => [e.path.join('.'), e.message]))
    );
  }

  const { connectorId, status } = queryParsed.data;

  const where = {
    ...ownerWhere(ctx),
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

  if (parsed.data.connectorId) {
    const connector = await loadConnector(parsed.data.connectorId, ctx.teamId);
    if (!connector) {
      const publicConn = await prisma.serviceConnector.findFirst({
        where: { id: parsed.data.connectorId, visibility: 'public', status: 'published' },
      });
      if (!publicConn) {
        return errors.notFound('Connector');
      }
    }
  }

  if (parsed.data.planId) {
    const plan = await prisma.gatewayPlan.findFirst({
      where: { id: parsed.data.planId, ...ownerWhere(ctx) },
    });
    if (!plan) {
      return errors.notFound('Plan');
    }
  }

  const rawKey = `gw_${randomBytes(32).toString('hex')}`;
  const keyHash = createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 11);

  const ownerData = ctx.isPersonal
    ? { ownerUserId: ctx.userId }
    : { teamId: ctx.teamId };

  const apiKey = await prisma.gatewayApiKey.create({
    data: {
      ...ownerData,
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

  logAudit(ctx, { action: 'key.create', resourceId: apiKey.id, details: { name: parsed.data.name, keyPrefix }, request });

  const { keyHash: _, ...safeKey } = apiKey;
  return success({
    ...safeKey,
    rawKey,
  });
}
