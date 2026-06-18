/**
 * Application / service registry (NAAP-D).
 *
 *   GET  /api/v1/apps   — list apps in the caller's scope
 *   POST /api/v1/apps   — register a new app/service
 *
 * Gated behind the `app_registry` flag (default OFF): when OFF this route is a
 * no-op (404), so registering apps is dormant until an admin enables it. Zero
 * regression — no existing surface changes.
 *
 * Never logs secrets/PII — only request metadata + correlation id.
 */

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { prisma } from '@/lib/db';
import { success, errors, parsePagination, successPaginated } from '@/lib/api/response';
import { getAdminContext, isErrorResponse } from '@/lib/gateway/admin/team-guard';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { APP_REGISTRY_FLAG, APP_SCOPES, APP_TYPES } from '@/lib/apps/registry';

const SLUG_RE = /^[a-z0-9][a-z0-9-]{1,62}$/;

const createAppSchema = z.object({
  slug: z.string().regex(SLUG_RE, 'slug must be lowercase alphanumeric/hyphen, 2-63 chars'),
  name: z.string().min(1).max(128),
  type: z.enum(APP_TYPES).default('app'),
  allowedScopes: z.array(z.enum(APP_SCOPES)).default([]),
  allowedCapabilities: z.array(z.string().min(1).max(128)).default([]),
});

function ownerWhere(ctx: { teamId: string; userId: string; isPersonal: boolean }) {
  return ctx.isPersonal ? { ownerUserId: ctx.userId } : { teamId: ctx.teamId };
}

function correlationId(request: NextRequest): string {
  return request.headers.get('x-request-id')?.trim() || randomUUID();
}

function log(event: string, fields: Record<string, unknown>): void {
  console.info(JSON.stringify({ level: 'info', event, ...fields }));
}

export async function GET(request: NextRequest) {
  if (!(await isFeatureEnabled(APP_REGISTRY_FLAG))) return errors.notFound('Resource');

  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { page, pageSize, skip } = parsePagination(request.nextUrl.searchParams);
  const where = ownerWhere(ctx);

  const [apps, total] = await Promise.all([
    prisma.application.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: pageSize,
    }),
    prisma.application.count({ where }),
  ]);

  return successPaginated(apps, { page, pageSize, total });
}

export async function POST(request: NextRequest) {
  if (!(await isFeatureEnabled(APP_REGISTRY_FLAG))) return errors.notFound('Resource');

  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errors.badRequest('Invalid JSON body');
  }

  const parsed = createAppSchema.safeParse(body);
  if (!parsed.success) {
    return errors.validationError(
      Object.fromEntries(parsed.error.errors.map((e) => [e.path.join('.'), e.message])),
    );
  }

  const existing = await prisma.application.findUnique({
    where: { slug: parsed.data.slug },
    select: { id: true },
  });
  if (existing) return errors.conflict('An application with this slug already exists');

  const ownerData = ctx.isPersonal
    ? { ownerUserId: ctx.userId }
    : { teamId: ctx.teamId };

  let app;
  try {
    app = await prisma.application.create({
      data: {
        ...ownerData,
        createdBy: ctx.userId,
        slug: parsed.data.slug,
        name: parsed.data.name,
        type: parsed.data.type,
        allowedScopes: parsed.data.allowedScopes,
        allowedCapabilities: parsed.data.allowedCapabilities,
      },
    });
  } catch (e) {
    // The findUnique pre-check above is not race-safe; rely on the DB unique
    // constraint as the source of truth and map P2002 to a 409.
    if (e && typeof e === 'object' && 'code' in e && (e as { code?: string }).code === 'P2002') {
      return errors.conflict('An application with this slug already exists');
    }
    throw e;
  }

  log('app.register', {
    correlationId: correlationId(request),
    appId: app.id,
    slug: app.slug,
    scope: ctx.isPersonal ? 'personal' : 'team',
  });

  return success(app);
}
