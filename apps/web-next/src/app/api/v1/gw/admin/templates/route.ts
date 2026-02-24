/**
 * Service Gateway — Admin: Templates
 * GET  /api/v1/gw/admin/templates        — List available templates
 * POST /api/v1/gw/admin/templates         — Create connector from template
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';
import { getAdminContext, isErrorResponse } from '@/lib/gateway/admin/team-guard';
import { invalidateConnectorCache } from '@/lib/gateway/resolve';

// ── Built-in templates (loaded from JSON at build time) ──

interface TemplateEndpoint {
  name: string;
  description?: string;
  method: string;
  path: string;
  upstreamPath: string;
  upstreamContentType?: string;
  bodyTransform?: string;
  bodyBlacklist?: string[];
  bodyPattern?: string;
  bodySchema?: unknown;
  cacheTtl?: number;
  timeout?: number;
  retries?: number;
}

interface Template {
  id: string;
  name: string;
  description: string;
  icon: string;
  category: string;
  connector: {
    slug: string;
    displayName: string;
    description?: string;
    authType: string;
    authConfig: Record<string, unknown>;
    secretRefs: string[];
    streamingEnabled?: boolean;
    responseWrapper?: boolean;
    healthCheckPath?: string;
    defaultTimeout?: number;
    tags?: string[];
  };
  endpoints: TemplateEndpoint[];
}

// Templates are embedded at build time — in production these would be loaded from files
const TEMPLATES: Template[] = [
  {
    id: 'ai-llm',
    name: 'AI / LLM',
    description: 'OpenAI-compatible LLM inference API — works with OpenAI, Anthropic, Azure OpenAI, Ollama, vLLM',
    icon: '🤖',
    category: 'ai',
    connector: {
      slug: 'ai-llm',
      displayName: 'AI / LLM API',
      description: 'OpenAI-compatible LLM inference API',
      authType: 'bearer',
      authConfig: { tokenRef: 'token' },
      secretRefs: ['token'],
      streamingEnabled: true,
      responseWrapper: true,
      healthCheckPath: '/v1/models',
      defaultTimeout: 60000,
      tags: ['ai', 'llm', 'openai'],
    },
    endpoints: [
      { name: 'Chat Completions', method: 'POST', path: '/chat', upstreamPath: '/v1/chat/completions', upstreamContentType: 'application/json', bodyTransform: 'passthrough', timeout: 60000, retries: 1 },
      { name: 'Completions', method: 'POST', path: '/completions', upstreamPath: '/v1/completions', upstreamContentType: 'application/json', bodyTransform: 'passthrough', timeout: 60000, retries: 1 },
      { name: 'Embeddings', method: 'POST', path: '/embeddings', upstreamPath: '/v1/embeddings', upstreamContentType: 'application/json', bodyTransform: 'passthrough' },
      { name: 'List Models', method: 'GET', path: '/models', upstreamPath: '/v1/models', upstreamContentType: 'application/json', bodyTransform: 'passthrough', cacheTtl: 300 },
    ],
  },
  {
    id: 'clickhouse',
    name: 'ClickHouse',
    description: 'ClickHouse analytics database — SQL queries with SELECT-only enforcement',
    icon: '📊',
    category: 'analytics',
    connector: {
      slug: 'clickhouse',
      displayName: 'ClickHouse',
      description: 'ClickHouse analytics query API with SELECT-only enforcement',
      authType: 'basic',
      authConfig: { usernameRef: 'username', passwordRef: 'password' },
      secretRefs: ['username', 'password'],
      streamingEnabled: false,
      responseWrapper: true,
      healthCheckPath: '/ping',
      defaultTimeout: 30000,
      tags: ['analytics', 'database', 'clickhouse', 'sql'],
    },
    endpoints: [
      { name: 'Query', method: 'POST', path: '/query', upstreamPath: '/', upstreamContentType: 'application/json', bodyTransform: 'passthrough', bodyBlacklist: ['DROP', 'DELETE', 'INSERT', 'UPDATE', 'ALTER', 'CREATE', 'TRUNCATE'], bodyPattern: '(?i)^\\s*SELECT\\b', timeout: 30000 },
      { name: 'Tables', method: 'GET', path: '/tables', upstreamPath: '/?query=SHOW+TABLES+FORMAT+JSON', upstreamContentType: 'application/json', bodyTransform: 'passthrough', cacheTtl: 60 },
    ],
  },
  {
    id: 'daydream',
    name: 'Daydream API',
    description: 'Daydream.live real-time AI video generation API',
    icon: '🎥',
    category: 'media',
    connector: {
      slug: 'daydream',
      displayName: 'Daydream API',
      description: 'Real-time AI video generation via Daydream.live',
      authType: 'bearer',
      authConfig: { tokenRef: 'token' },
      secretRefs: ['token'],
      streamingEnabled: true,
      responseWrapper: true,
      healthCheckPath: '/health',
      defaultTimeout: 30000,
      tags: ['ai', 'video', 'streaming', 'daydream'],
    },
    endpoints: [
      { name: 'Create Stream', method: 'POST', path: '/streams', upstreamPath: '/api/v1/streams', upstreamContentType: 'application/json', bodyTransform: 'passthrough' },
      { name: 'Get Stream', method: 'GET', path: '/streams/:id', upstreamPath: '/api/v1/streams/:id', upstreamContentType: 'application/json', bodyTransform: 'passthrough' },
      { name: 'Update Prompt', method: 'PUT', path: '/streams/:id/prompt', upstreamPath: '/api/v1/streams/:id/prompt', upstreamContentType: 'application/json', bodyTransform: 'passthrough' },
      { name: 'Stop Stream', method: 'DELETE', path: '/streams/:id', upstreamPath: '/api/v1/streams/:id', upstreamContentType: 'application/json', bodyTransform: 'passthrough' },
    ],
  },
];

export async function GET() {
  const summaries = TEMPLATES.map(({ id, name, description, icon, category, connector }) => ({
    id,
    name,
    description,
    icon,
    category,
    slug: connector.slug,
    authType: connector.authType,
    endpointCount: TEMPLATES.find((t) => t.id === id)?.endpoints.length || 0,
  }));

  return success(summaries);
}

export async function POST(request: NextRequest) {
  const ctx = await getAdminContext(request);
  if (isErrorResponse(ctx)) return ctx;

  let body: { templateId: string; upstreamBaseUrl: string; slug?: string };
  try {
    body = await request.json();
  } catch {
    return errors.badRequest('Invalid JSON body');
  }

  const { templateId, upstreamBaseUrl, slug: customSlug } = body;

  if (!templateId || !upstreamBaseUrl) {
    return errors.badRequest('templateId and upstreamBaseUrl are required');
  }

  const template = TEMPLATES.find((t) => t.id === templateId);
  if (!template) {
    return errors.notFound('Template');
  }

  const slug = customSlug || template.connector.slug;

  const existing = ctx.isPersonal
    ? await prisma.serviceConnector.findUnique({
        where: { ownerUserId_slug: { ownerUserId: ctx.userId, slug } },
      })
    : await prisma.serviceConnector.findUnique({
        where: { teamId_slug: { teamId: ctx.teamId, slug } },
      });
  if (existing) {
    return errors.conflict(`Connector with slug "${slug}" already exists. Use a custom slug.`);
  }

  let allowedHosts: string[] = [];
  try {
    const url = new URL(upstreamBaseUrl);
    allowedHosts = [url.hostname];
  } catch {
    return errors.badRequest('Invalid upstreamBaseUrl');
  }

  const ownerData = ctx.isPersonal
    ? { ownerUserId: ctx.userId }
    : { teamId: ctx.teamId };

  const connector = await prisma.serviceConnector.create({
    data: {
      ...ownerData,
      createdBy: ctx.userId,
      slug,
      displayName: template.connector.displayName,
      description: template.connector.description || '',
      upstreamBaseUrl,
      allowedHosts,
      authType: template.connector.authType,
      authConfig: template.connector.authConfig,
      secretRefs: template.connector.secretRefs,
      streamingEnabled: template.connector.streamingEnabled ?? false,
      responseWrapper: template.connector.responseWrapper ?? true,
      healthCheckPath: template.connector.healthCheckPath || null,
      defaultTimeout: template.connector.defaultTimeout ?? 30000,
      tags: template.connector.tags || [],
      status: 'draft',
    },
  });

  // Create endpoints from template
  for (const ep of template.endpoints) {
    await prisma.connectorEndpoint.create({
      data: {
        connectorId: connector.id,
        name: ep.name,
        method: ep.method,
        path: ep.path,
        upstreamPath: ep.upstreamPath,
        upstreamContentType: ep.upstreamContentType || 'application/json',
        bodyTransform: ep.bodyTransform || 'passthrough',
        bodyBlacklist: ep.bodyBlacklist || [],
        bodyPattern: ep.bodyPattern || null,
        bodySchema: ep.bodySchema || null,
        cacheTtl: ep.cacheTtl || null,
        timeout: ep.timeout || null,
        retries: ep.retries || 0,
      },
    });
  }

  invalidateConnectorCache(ctx.teamId, connector.slug);

  // Reload with endpoints
  const created = await prisma.serviceConnector.findUnique({
    where: { id: connector.id },
    include: { endpoints: true },
  });

  return success({
    connector: created,
    templateId,
    message: `Connector created from "${template.name}" template. Configure secrets and publish when ready.`,
  });
}
