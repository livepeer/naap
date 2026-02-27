/**
 * Service Gateway — Admin: Templates
 * GET  /api/v1/gw/admin/templates        — List available connector templates
 * POST /api/v1/gw/admin/templates         — Create connector from template
 */

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';
import { getAdminContext, isErrorResponse } from '@/lib/gateway/admin/team-guard';
import {
  loadConnectorTemplates,
  getTemplateById,
  type ConnectorTemplate,
} from '@/lib/gateway/connector-templates';

export async function GET() {
  const templates = await loadConnectorTemplates();

  const summaries = templates.map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    icon: t.icon,
    category: t.category,
    slug: t.connector.slug,
    authType: t.connector.authType,
    endpointCount: t.endpoints.length,
  }));

  return success(summaries);
}

export async function POST(request: NextRequest) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return errors.badRequest('Invalid JSON body');
  }

  if (!rawBody || typeof rawBody !== 'object') {
    return errors.badRequest('Request body must be a JSON object');
  }

  const body = rawBody as Record<string, unknown>;
  const templateId = typeof body.templateId === 'string' ? body.templateId : '';
  const upstreamBaseUrl = typeof body.upstreamBaseUrl === 'string' ? body.upstreamBaseUrl : '';
  const customSlug = typeof body.slug === 'string' ? body.slug : undefined;

  if (!templateId || !upstreamBaseUrl) {
    return errors.badRequest('templateId and upstreamBaseUrl are required');
  }

  const template = await getTemplateById(templateId);
  if (!template) {
    return errors.notFound('Template');
  }

  const slug = customSlug || template.connector.slug;

  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    return errors.badRequest('Slug must be lowercase alphanumeric with hyphens');
  }

  let allowedHosts: string[] = [];
  try {
    const url = new URL(upstreamBaseUrl);
    allowedHosts = [url.hostname];
  } catch {
    return errors.badRequest('Invalid upstreamBaseUrl');
  }

  const created = await prisma.$transaction(async (tx) => {
    const existing = await tx.serviceConnector.findUnique({
      where: { teamId_slug: { teamId: ctx.teamId, slug } },
    });
    if (existing) {
      throw new Error(`CONFLICT:Connector with slug "${slug}" already exists. Use a custom slug.`);
    }

    const connector = await tx.serviceConnector.create({
      data: {
        teamId: ctx.teamId,
        createdBy: ctx.userId,
        slug,
        displayName: template.connector.displayName,
        description: template.connector.description || '',
        upstreamBaseUrl,
        allowedHosts,
        authType: template.connector.authType,
        authConfig: template.connector.authConfig || {},
        secretRefs: template.connector.secretRefs,
        streamingEnabled: template.connector.streamingEnabled ?? false,
        responseWrapper: template.connector.responseWrapper ?? true,
        healthCheckPath: template.connector.healthCheckPath || null,
        defaultTimeout: template.connector.defaultTimeout ?? 30000,
        tags: template.connector.tags || [],
        status: 'draft',
      },
    });

    await tx.connectorEndpoint.createMany({
      data: template.endpoints.map((ep) => ({
        connectorId: connector.id,
        name: ep.name,
        method: ep.method,
        path: ep.path,
        upstreamPath: ep.upstreamPath,
        upstreamContentType: ep.upstreamContentType || 'application/json',
        bodyTransform: ep.bodyTransform || 'passthrough',
        bodyBlacklist: ep.bodyBlacklist || [],
        bodyPattern: ep.bodyPattern || null,
        bodySchema: ep.bodySchema ?? undefined,
        cacheTtl: ep.cacheTtl ?? null,
        timeout: ep.timeout ?? null,
        retries: ep.retries ?? 0,
      })),
    });

    return tx.serviceConnector.findUnique({
      where: { id: connector.id },
      include: { endpoints: true },
    });
  }).catch((err) => {
    if (err instanceof Error && err.message.startsWith('CONFLICT:')) {
      return err.message.slice('CONFLICT:'.length);
    }
    throw err;
  });

  if (typeof created === 'string') {
    return errors.conflict(created);
  }

  return success({
    connector: created,
    templateId,
    message: `Connector created from "${template.name}" template. Configure secrets and publish when ready.`,
  });
}
