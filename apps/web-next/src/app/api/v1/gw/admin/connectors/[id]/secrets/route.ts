/**
 * Service Gateway — Admin: Connector Secrets
 * GET  /api/v1/gw/admin/connectors/:id/secrets  — List secret status (configured or not)
 * PUT  /api/v1/gw/admin/connectors/:id/secrets  — Set/update secrets
 *
 * Owner-only: only the connector owner can manage upstream secrets.
 * Raw secret values are NEVER returned in GET responses.
 *
 * Secrets are stored directly via Prisma with AES-256-GCM encryption,
 * matching the encryption scheme used by /api/v1/secrets.
 */

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { success, errors } from '@/lib/api/response';
import { getAdminContext, isErrorResponse, loadOwnedConnector } from '@/lib/gateway/admin/team-guard';
import { encrypt } from '@/lib/gateway/encryption';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/gateway/admin/audit';

type RouteContext = { params: Promise<{ id: string }> };

const SECRET_KEY_PREFIX = 'gw';

function secretKey(scopeId: string, connectorSlug: string, name: string): string {
  return `${SECRET_KEY_PREFIX}:${scopeId}:${connectorSlug}:${name}`;
}

export async function GET(request: NextRequest, context: RouteContext) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { id } = await context.params;
  const connector = await loadOwnedConnector(id, ctx.teamId);
  if (!connector) {
    return errors.notFound('Connector');
  }

  const secretRefs: string[] = connector.secretRefs || [];
  const statuses = await Promise.all(
    secretRefs.map(async (name) => {
      const key = secretKey(ctx.teamId, connector.slug, name);
      const record = await prisma.secretVault.findUnique({
        where: { key },
        select: { updatedAt: true },
      });
      return {
        name,
        configured: !!record,
        ...(record ? { updatedAt: record.updatedAt.toISOString() } : {}),
      };
    })
  );

  return success(statuses);
}

export async function PUT(request: NextRequest, context: RouteContext) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  const { id } = await context.params;
  const connector = await loadOwnedConnector(id, ctx.teamId);
  if (!connector) {
    return errors.notFound('Connector');
  }

  let body: Record<string, string>;
  try {
    body = await request.json();
  } catch {
    return errors.badRequest('Invalid JSON body');
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return errors.badRequest('Body must be a JSON object mapping secret names to values');
  }

  const secretRefs: string[] = connector.secretRefs || [];
  const refSet = new Set(secretRefs);

  const invalidKeys = Object.keys(body).filter((k) => !refSet.has(k));
  if (invalidKeys.length > 0) {
    return errors.badRequest(
      `Unknown secret ref(s): ${invalidKeys.join(', ')}. Valid refs: ${secretRefs.join(', ')}`
    );
  }

  const emptyKeys = Object.entries(body).filter(([, v]) => !v || typeof v !== 'string' || v.trim() === '');
  if (emptyKeys.length > 0) {
    return errors.badRequest(`Secret value(s) cannot be empty: ${emptyKeys.map(([k]) => k).join(', ')}`);
  }

  await Promise.all(
    Object.entries(body).map(async ([name, value]) => {
      const key = secretKey(ctx.teamId, connector.slug, name);
      const { encryptedValue, iv } = encrypt(value);
      await prisma.secretVault.upsert({
        where: { key },
        update: { encryptedValue, iv, updatedAt: new Date() },
        create: {
          key,
          encryptedValue,
          iv,
          scope: ctx.teamId,
          createdBy: ctx.userId,
        },
      });
    })
  );

  logAudit(ctx, { action: 'secret.set', resourceId: id, details: { refs: Object.keys(body), slug: connector.slug }, request });

  const updatedStatuses = await Promise.all(
    secretRefs.map(async (name) => {
      const key = secretKey(ctx.teamId, connector.slug, name);
      const record = await prisma.secretVault.findUnique({
        where: { key },
        select: { updatedAt: true },
      });
      return {
        name,
        configured: !!record,
        ...(record ? { updatedAt: record.updatedAt.toISOString() } : {}),
      };
    })
  );

  return success(updatedStatuses);
}
