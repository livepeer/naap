/**
 * Service Gateway — Admin: Connector List / Create
 * GET  /api/v1/gw/admin/connectors   — List connectors (scope-aware)
 * POST /api/v1/gw/admin/connectors   — Create draft connector
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success, successPaginated, errors, parsePagination } from '@/lib/api/response';
import { getAdminContext, isErrorResponse } from '@/lib/gateway/admin/team-guard';
import { createConnectorSchema } from '@/lib/gateway/admin/validation';
import { invalidateConnectorCache } from '@/lib/gateway/resolve';
import { logAudit } from '@/lib/gateway/admin/audit';

function ownerWhere(ctx: { teamId: string; userId: string; isPersonal: boolean }) {
  if (ctx.isPersonal) return { ownerUserId: ctx.userId };
  return { teamId: ctx.teamId };
}

export async function GET(request: NextRequest) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { searchParams } = request.nextUrl;
  const { page, pageSize, skip } = parsePagination(searchParams);
  const status = searchParams.get('status');
  const category = searchParams.get('category');

  const scope = searchParams.get('scope') || 'all'; // own | public | all

  const scopeCondition =
    scope === 'own'
      ? ownerWhere(ctx)
      : scope === 'public'
        ? { visibility: 'public', status: 'published' }
        : {
            OR: [
              ownerWhere(ctx),
              { visibility: 'public', status: 'published' },
            ],
          };

  const where = {
    ...scopeCondition,
    ...(status && scope !== 'public' ? { status } : {}),
    ...(category ? { category } : {}),
  };

  const [connectors, total] = await Promise.all([
    prisma.serviceConnector.findMany({
      where,
      include: { endpoints: { select: { id: true } } },
      orderBy: { updatedAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.serviceConnector.count({ where }),
  ]);

  const data = connectors.map((c) => ({
    ...c,
    endpointCount: c.endpoints.length,
    endpoints: undefined,
  }));

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

  const parsed = createConnectorSchema.safeParse(body);
  if (!parsed.success) {
    return errors.validationError(
      Object.fromEntries(
        parsed.error.errors.map((e) => [e.path.join('.'), e.message])
      )
    );
  }

  // Check for duplicate slug within scope
  const existing = ctx.isPersonal
    ? await prisma.serviceConnector.findUnique({
        where: { ownerUserId_slug: { ownerUserId: ctx.userId, slug: parsed.data.slug } },
      })
    : await prisma.serviceConnector.findUnique({
        where: { teamId_slug: { teamId: ctx.teamId, slug: parsed.data.slug } },
      });
  if (existing) {
    return errors.conflict(`Connector with slug "${parsed.data.slug}" already exists`);
  }

  let allowedHosts = parsed.data.allowedHosts;
  if (allowedHosts.length === 0) {
    try {
      const url = new URL(parsed.data.upstreamBaseUrl);
      allowedHosts = [url.hostname];
    } catch {
      // Invalid URL — will be caught by further validation
    }
  }

  const ownerData = ctx.isPersonal
    ? { ownerUserId: ctx.userId }
    : { teamId: ctx.teamId };

  const connector = await prisma.serviceConnector.create({
    data: {
      ...ownerData,
      createdBy: ctx.userId,
      ...parsed.data,
      allowedHosts,
      status: 'draft',
    },
  });

  invalidateConnectorCache(ctx.teamId, connector.slug);

  logAudit(ctx, { action: 'connector.create', resourceId: connector.id, details: { slug: connector.slug }, request });

  return success(connector);
}
