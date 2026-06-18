/**
 * Application / service registry — single app (NAAP-D).
 *
 *   GET    /api/v1/apps/{id}  — fetch one app (own scope)
 *   PATCH  /api/v1/apps/{id}  — update name/type/scopes/capabilities/status
 *   DELETE /api/v1/apps/{id}  — remove an app
 *
 * Gated behind the `app_registry` flag (default OFF) → 404 when OFF.
 * Returns 404 (not 403) for other scopes' apps to prevent enumeration.
 */

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { z } from 'zod';

import { prisma } from '@/lib/db';
import { success, successNoContent, errors } from '@/lib/api/response';
import { getAdminContext, isErrorResponse } from '@/lib/gateway/admin/team-guard';
import { isFeatureEnabled } from '@/lib/feature-flags';
import { APP_REGISTRY_FLAG, APP_SCOPES, APP_TYPES } from '@/lib/apps/registry';

type Params = { params: Promise<{ id: string }> };

const updateAppSchema = z
  .object({
    name: z.string().min(1).max(128).optional(),
    type: z.enum(APP_TYPES).optional(),
    allowedScopes: z.array(z.enum(APP_SCOPES)).optional(),
    allowedCapabilities: z.array(z.string().min(1).max(128)).optional(),
    status: z.enum(['active', 'disabled']).optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: 'No fields to update' });

function ownerWhere(ctx: { teamId: string; userId: string; isPersonal: boolean }) {
  return ctx.isPersonal ? { ownerUserId: ctx.userId } : { teamId: ctx.teamId };
}

export async function GET(request: NextRequest, { params }: Params) {
  if (!(await isFeatureEnabled(APP_REGISTRY_FLAG))) return errors.notFound('Resource');

  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { id } = await params;
  const app = await prisma.application.findFirst({ where: { id, ...ownerWhere(ctx) } });
  if (!app) return errors.notFound('Application');
  return success(app);
}

export async function PATCH(request: NextRequest, { params }: Params) {
  if (!(await isFeatureEnabled(APP_REGISTRY_FLAG))) return errors.notFound('Resource');

  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errors.badRequest('Invalid JSON body');
  }

  const parsed = updateAppSchema.safeParse(body);
  if (!parsed.success) {
    return errors.validationError(
      Object.fromEntries(parsed.error.errors.map((e) => [e.path.join('.'), e.message])),
    );
  }

  const existing = await prisma.application.findFirst({
    where: { id, ...ownerWhere(ctx) },
    select: { id: true },
  });
  if (!existing) return errors.notFound('Application');

  const app = await prisma.application.update({
    where: { id },
    data: parsed.data,
  });
  return success(app);
}

export async function DELETE(request: NextRequest, { params }: Params) {
  if (!(await isFeatureEnabled(APP_REGISTRY_FLAG))) return errors.notFound('Resource');

  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { id } = await params;
  const existing = await prisma.application.findFirst({
    where: { id, ...ownerWhere(ctx) },
    select: { id: true },
  });
  if (!existing) return errors.notFound('Application');

  await prisma.application.delete({ where: { id } });
  return successNoContent();
}
