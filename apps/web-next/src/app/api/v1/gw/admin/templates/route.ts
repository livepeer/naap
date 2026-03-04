/**
 * Service Gateway — Admin: Templates
 * GET  /api/v1/gw/admin/templates        — List available connector templates
 * POST /api/v1/gw/admin/templates         — Create connector(s) from template(s)
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
import { invalidateConnectorCache } from '@/lib/gateway/resolve';

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
    upstreamBaseUrl: t.connector.upstreamBaseUrl,
    secretRefs: t.connector.secretRefs,
    endpoints: t.endpoints.map((ep) => ({
      name: ep.name,
      method: ep.method,
      path: ep.path,
      upstreamPath: ep.upstreamPath,
      upstreamContentType: ep.upstreamContentType || 'application/json',
      bodyTransform: ep.bodyTransform || 'passthrough',
    })),
  }));

  return success(summaries);
}

async function createConnectorFromTemplate(
  template: ConnectorTemplate,
  ctx: { teamId: string; userId: string; isPersonal: boolean },
  overrides?: { upstreamBaseUrl?: string; slug?: string }
) {
  const conn = template.connector;
  const slug = overrides?.slug || conn.slug;
  const upstreamBaseUrl = overrides?.upstreamBaseUrl || conn.upstreamBaseUrl;

  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    return errors.badRequest('Slug must be lowercase alphanumeric with hyphens');
  }

  const existing = ctx.isPersonal
    ? await prisma.serviceConnector.findUnique({
        where: { ownerUserId_slug: { ownerUserId: ctx.userId, slug } },
      })
    : await prisma.serviceConnector.findUnique({
        where: { teamId_slug: { teamId: ctx.teamId, slug } },
      });

  if (existing) {
    return { error: `Connector with slug "${slug}" already exists` };
  }

  let allowedHosts = conn.allowedHosts || [];
  if (allowedHosts.length === 0 && upstreamBaseUrl) {
    try {
      allowedHosts = [new URL(upstreamBaseUrl).hostname];
    } catch {
      return { error: `Invalid upstreamBaseUrl: ${upstreamBaseUrl}` };
    }
  }

  const ownerData = ctx.isPersonal
    ? { ownerUserId: ctx.userId }
    : { teamId: ctx.teamId };

  const created = await prisma.$transaction(async (tx) => {
    const connector = await tx.serviceConnector.create({
      data: {
        ...ownerData,
        createdBy: ctx.userId,
        slug,
        displayName: conn.displayName,
        description: conn.description || template.description,
        category: template.category,
        upstreamBaseUrl,
        allowedHosts,
        authType: conn.authType,
        authConfig: conn.authConfig || {},
        secretRefs: conn.secretRefs,
        streamingEnabled: conn.streamingEnabled ?? false,
        responseWrapper: conn.responseWrapper ?? true,
        healthCheckPath: conn.healthCheckPath || null,
        defaultTimeout: conn.defaultTimeout ?? 30000,
        tags: conn.tags || [],
        status: 'draft',
      },
    });

    await tx.connectorEndpoint.createMany({
      data: template.endpoints.map((ep) => ({
        connectorId: connector.id,
        name: ep.name,
        description: ep.description,
        method: ep.method,
        path: ep.path,
        upstreamPath: ep.upstreamPath,
        upstreamContentType: ep.upstreamContentType || 'application/json',
        bodyTransform: ep.bodyTransform || 'passthrough',
        bodyBlacklist: ep.bodyBlacklist || [],
        bodyPattern: ep.bodyPattern || null,
        cacheTtl: ep.cacheTtl || null,
        timeout: ep.timeout || null,
        retries: ep.retries || 0,
      })),
    });

    return tx.serviceConnector.findUnique({
      where: { id: connector.id },
      include: { endpoints: true },
    });
  });

  invalidateConnectorCache(ctx.teamId, slug);

  return { connector: created };
}

export async function POST(request: NextRequest) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  let body: {
    templateId?: string;
    templateIds?: string[];
    upstreamBaseUrl?: string;
    slug?: string;
  };
  try {
    body = await request.json();
  } catch {
    return errors.badRequest('Invalid JSON body');
  }

  const templateIds = body.templateIds || (body.templateId ? [body.templateId] : []);

  if (templateIds.length === 0) {
    return errors.badRequest('templateId or templateIds is required');
  }

  const templates: ConnectorTemplate[] = [];
  for (const id of templateIds) {
    const t = await getTemplateById(id);
    if (!t) {
      return errors.notFound(`Template "${id}"`);
    }
    templates.push(t);
  }

  const results: Array<{
    templateId: string;
    name: string;
    connectorId?: string;
    slug?: string;
    error?: string;
  }> = [];

  for (const template of templates) {
    const overrides = templates.length === 1
      ? { upstreamBaseUrl: body.upstreamBaseUrl, slug: body.slug }
      : undefined;

    const result = await createConnectorFromTemplate(template, ctx, overrides);

    if ('error' in result) {
      results.push({
        templateId: template.id,
        name: template.name,
        error: result.error as string,
      });
    } else {
      results.push({
        templateId: template.id,
        name: template.name,
        connectorId: result.connector?.id,
        slug: result.connector?.slug,
      });
    }
  }

  const created = results.filter((r) => r.connectorId);
  const failed = results.filter((r) => r.error);

  return success({
    created: created.length,
    failed: failed.length,
    results,
    message:
      failed.length === 0
        ? `${created.length} connector(s) created. Configure secrets and publish when ready.`
        : `${created.length} created, ${failed.length} failed.`,
  });
}
