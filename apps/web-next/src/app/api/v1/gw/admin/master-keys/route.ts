/**
 * Service Gateway — Admin: Master Key List / Create
 * GET  /api/v1/gw/admin/master-keys   — List master keys (scope-aware)
 * POST /api/v1/gw/admin/master-keys   — Create new master key (returns raw key ONCE)
 */

export const runtime = 'nodejs';

import { randomBytes, createHash } from 'crypto';
import { isIP } from 'net';
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success, successPaginated, errors, parsePagination } from '@/lib/api/response';
import { getAdminContext, isErrorResponse } from '@/lib/gateway/admin/team-guard';
import { logAudit } from '@/lib/gateway/admin/audit';
import { z } from 'zod';

function isValidIPOrCIDR(value: string): boolean {
  if (value.includes('/')) {
    const slashIdx = value.lastIndexOf('/');
    const ip = value.slice(0, slashIdx);
    const prefixStr = value.slice(slashIdx + 1);
    const ipVersion = isIP(ip);
    if (ipVersion === 0) return false;
    const prefix = Number(prefixStr);
    if (!Number.isInteger(prefix) || prefix < 0) return false;
    const maxPrefix = ipVersion === 4 ? 32 : 128;
    return prefix <= maxPrefix;
  }
  return isIP(value) !== 0;
}

const createKeySchema = z.object({
  name: z.string().min(1).max(128),
  scopes: z.array(z.string()).default(['proxy']),
  allowedIPs: z
    .array(
      z.string().refine(isValidIPOrCIDR, {
        message: 'Must be a valid IPv4, IPv6, or CIDR range',
      })
    )
    .default([]),
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
    status: z.enum(['active', 'revoked', 'expired']).optional(),
  });

  const queryParsed = listQuerySchema.safeParse({
    status: searchParams.get('status') ?? undefined,
  });

  if (!queryParsed.success) {
    return errors.validationError(
      Object.fromEntries(queryParsed.error.errors.map((e) => [e.path.join('.'), e.message]))
    );
  }

  const { status } = queryParsed.data;

  const where = {
    ...ownerWhere(ctx),
    ...(status ? { status } : {}),
  };

  const [keys, total] = await Promise.all([
    prisma.gatewayMasterKey.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.gatewayMasterKey.count({ where }),
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
      Object.fromEntries(parsed.error.errors.map((e) => [e.path.join('.'), e.message]))
    );
  }

  const rawKey = `gwm_${randomBytes(32).toString('hex')}`;
  const keyHash = createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 12);

  const ownerData = ctx.isPersonal
    ? { ownerUserId: ctx.userId }
    : { teamId: ctx.teamId };

  const masterKey = await prisma.gatewayMasterKey.create({
    data: {
      ...ownerData,
      createdBy: ctx.userId,
      name: parsed.data.name,
      keyHash,
      keyPrefix,
      scopes: parsed.data.scopes,
      allowedIPs: parsed.data.allowedIPs,
      expiresAt: parsed.data.expiresAt ? new Date(parsed.data.expiresAt) : null,
    },
  });

  logAudit(ctx, {
    action: 'master-key.create',
    resourceId: masterKey.id,
    details: { name: parsed.data.name, keyPrefix },
    request,
  }).catch(() => {});

  const { keyHash: _, ...safeKey } = masterKey;
  return success({
    ...safeKey,
    rawKey,
  });
}
