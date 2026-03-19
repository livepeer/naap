/**
 * Catch-all route for plugin APIs
 * GET/POST/PUT/PATCH/DELETE /api/v1/:plugin/*
 *
 * This route proxies requests to plugin backend services.
 * In production, these would be handled by the plugin's serverless functions.
 *
 * On Vercel, the static registry/* routes may not take priority over this
 * catch-all. When that happens, this route handles registry/examples
 * requests inline using the generated examples manifest.
 */

import { NextRequest, NextResponse } from 'next/server';
import { getAuthToken } from '@/lib/api/response';
import { PLUGIN_PORTS, DEFAULT_PORT } from '@/lib/plugin-ports';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { EXAMPLES_MANIFEST as _MANIFEST } from '../../../../../generated/examples-manifest';

// Module-load sanity check (visible in Vercel function logs)
const EXAMPLES_MANIFEST = Array.isArray(_MANIFEST) ? _MANIFEST : [];
console.log(`[catch-all] Module loaded: EXAMPLES_MANIFEST has ${EXAMPLES_MANIFEST.length} entries (raw type=${typeof _MANIFEST}, isArray=${Array.isArray(_MANIFEST)})`);

// ─── Plugin service URL map ─────────────────────────────────────────────────
// Ports come from PLUGIN_PORTS (which mirrors plugin.json devPort values).
// Env-var overrides allow production deployments to point at real hosts.
// ─────────────────────────────────────────────────────────────────────────────

/** Mapping from plugin kebab-name to its env-var override key. */
const PLUGIN_ENV_MAP: Record<string, string> = {
  'capacity-planner': 'CAPACITY_PLANNER_URL',
  'marketplace': 'MARKETPLACE_URL',
  'community': 'COMMUNITY_URL',
  'my-wallet': 'WALLET_URL',
  'my-dashboard': 'DASHBOARD_URL',
  'daydream-video': 'DAYDREAM_VIDEO_URL',
  'developer-api': 'DEVELOPER_API_URL',
  'plugin-publisher': 'PLUGIN_PUBLISHER_URL',
};

/** Short aliases so both `/api/v1/wallet/...` and `/api/v1/my-wallet/...` resolve. */
const SHORT_ALIASES: Record<string, string> = {
  'capacity': 'capacity-planner',
  'wallet': 'my-wallet',
  'dashboard': 'my-dashboard',
  'daydream': 'daydream-video',
};

function buildPluginServices(): Record<string, string> {
  const services: Record<string, string> = {};

  for (const [name, envKey] of Object.entries(PLUGIN_ENV_MAP)) {
    const port = (PLUGIN_PORTS as Record<string, number>)[name] ?? DEFAULT_PORT;
    services[name] = process.env[envKey] || `http://localhost:${port}`;
  }

  // Register short aliases pointing to the same resolved URL
  for (const [alias, canonical] of Object.entries(SHORT_ALIASES)) {
    if (services[canonical]) {
      services[alias] = services[canonical];
    }
  }

  return services;
}

const PLUGIN_SERVICES = buildPluginServices();

const PLUGIN_CDN_URL = process.env.PLUGIN_CDN_URL || '/cdn/plugins';
const IS_VERCEL = process.env.VERCEL === '1';

/**
 * Prefixes that have their own dedicated Next.js route handlers and must
 * never be treated as plugin names by this catch-all proxy.
 */
const RESERVED_PREFIXES = new Set([
  'auth', 'base', 'storage', 'livepeer', 'pipelines', 'gw',
]);

// ─── Registry examples handlers (inlined for Vercel compatibility) ──────────

async function handleListExamples(request: NextRequest): Promise<NextResponse> {
  const token = getAuthToken(request);
  if (!token) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const user = await validateSession(token);
  if (!user) {
    return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
  }

  const flag = await prisma.featureFlag.findUnique({
    where: { key: 'enableExamplePublishing' },
  });
  if (!flag?.enabled) {
    return NextResponse.json({ error: 'Example plugin publishing is not enabled' }, { status: 403 });
  }

  const examples = EXAMPLES_MANIFEST;
  console.log(`[registry/examples] Manifest has ${examples.length} entries`);

  const publishedPkgs = examples.length > 0
    ? await prisma.pluginPackage.findMany({
        where: { name: { in: examples.map((e) => e.name) }, publishStatus: 'published' },
        select: { name: true },
      })
    : [];
  const publishedSet = new Set(publishedPkgs.map((p) => p.name));

  const result = examples.map((e) => ({ ...e, alreadyPublished: publishedSet.has(e.name) }));
  return NextResponse.json({
    success: true,
    examples: result,
    _debug: {
      manifestLength: EXAMPLES_MANIFEST.length,
      manifestType: typeof EXAMPLES_MANIFEST,
      isArray: Array.isArray(EXAMPLES_MANIFEST),
      firstEntry: EXAMPLES_MANIFEST[0] || null,
      rawImportType: typeof _MANIFEST,
      rawImportIsArray: Array.isArray(_MANIFEST),
      rawImportLength: Array.isArray(_MANIFEST) ? _MANIFEST.length : -1,
      rawImportKeys: _MANIFEST ? Object.keys(_MANIFEST).slice(0, 5) : [],
    },
  });
}

async function handlePublishExample(
  request: NextRequest,
  pluginName: string,
): Promise<NextResponse> {
  const token = getAuthToken(request);
  if (!token) {
    return NextResponse.json({ error: 'Authentication required' }, { status: 401 });
  }

  const user = await validateSession(token);
  if (!user) {
    return NextResponse.json({ error: 'Invalid or expired session' }, { status: 401 });
  }

  const flag = await prisma.featureFlag.findUnique({
    where: { key: 'enableExamplePublishing' },
  });
  if (!flag?.enabled) {
    return NextResponse.json({ error: 'Example plugin publishing is not enabled' }, { status: 403 });
  }

  const example = EXAMPLES_MANIFEST.find((e) => e.name === pluginName);
  if (!example) {
    return NextResponse.json({ error: 'Example plugin not found' }, { status: 404 });
  }

  // On Vercel, bundles are in public/cdn/ (served statically). Locally, check dist/.
  if (!IS_VERCEL && !example.hasBuild) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require('fs');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pathMod = require('path');
      let rootDir = process.cwd();
      for (let i = 0; i < 5; i++) {
        if (fs.existsSync(pathMod.join(rootDir, 'examples'))) break;
        rootDir = pathMod.dirname(rootDir);
      }
      const distBundle = pathMod.join(rootDir, 'dist', 'plugins', example.dirName, example.version, `${example.dirName}.js`);
      if (!fs.existsSync(distBundle)) {
        return NextResponse.json(
          { error: `Plugin "${example.dirName}" must be built first`, hint: `Run: bin/build-plugins.sh --plugin ${example.dirName}` },
          { status: 400 },
        );
      }
    } catch { /* fall through */ }
  }

  const bundleUrl = `${PLUGIN_CDN_URL}/${example.dirName}/${example.version}/${example.dirName}.js`;

  const result = await prisma.$transaction(async (tx) => {
    const pkg = await tx.pluginPackage.upsert({
      where: { name: example.name },
      update: {
        displayName: example.displayName, description: example.description,
        category: example.category, author: example.author,
        authorEmail: example.authorEmail || 'team@naap.io',
        repository: example.repository, license: example.license,
        keywords: example.keywords, icon: example.icon, publishStatus: 'published',
      },
      create: {
        name: example.name, displayName: example.displayName,
        description: example.description || `${example.displayName} plugin for NAAP`,
        category: example.category || 'other', author: example.author || 'NAAP Team',
        authorEmail: example.authorEmail || 'team@naap.io',
        repository: example.repository, license: example.license,
        keywords: example.keywords, icon: example.icon, isCore: false,
        publishStatus: 'published',
      },
    });

    const version = await tx.pluginVersion.upsert({
      where: { packageId_version: { packageId: pkg.id, version: example.version } },
      update: {
        frontendUrl: bundleUrl,
        manifest: { name: example.name, displayName: example.displayName, version: example.version, description: example.description, category: example.category, icon: example.icon } as any,
      },
      create: {
        packageId: pkg.id, version: example.version, frontendUrl: bundleUrl,
        manifest: { name: example.name, displayName: example.displayName, version: example.version, description: example.description, category: example.category, icon: example.icon },
      },
    });

    const existingWP = await tx.workflowPlugin.findUnique({ where: { name: example.name }, select: { metadata: true } });
    const mergedMetadata = { ...((existingWP?.metadata as Record<string, unknown>) || {}), originalRoutes: example.originalRoutes };
    await tx.workflowPlugin.upsert({
      where: { name: example.name },
      update: {
        displayName: example.displayName, version: example.version,
        remoteUrl: bundleUrl, bundleUrl, stylesUrl: null,
        globalName: example.globalName, deploymentType: 'cdn',
        routes: example.routes, enabled: true, order: example.order,
        icon: example.icon, metadata: mergedMetadata,
      },
      create: {
        name: example.name, displayName: example.displayName,
        version: example.version, remoteUrl: bundleUrl, bundleUrl,
        stylesUrl: null, globalName: example.globalName,
        deploymentType: 'cdn', routes: example.routes, enabled: true,
        order: example.order, icon: example.icon, metadata: mergedMetadata,
      },
    });

    const deployment = await tx.pluginDeployment.upsert({
      where: { packageId: pkg.id },
      update: { versionId: version.id, status: 'running', frontendUrl: bundleUrl, deployedAt: new Date(), healthStatus: 'healthy' },
      create: { packageId: pkg.id, versionId: version.id, status: 'running', frontendUrl: bundleUrl, deployedAt: new Date(), healthStatus: 'healthy', activeInstalls: 0 },
    });

    const existingInstall = await tx.tenantPluginInstall.findFirst({
      where: { userId: user.id, deploymentId: deployment.id, status: { not: 'uninstalled' } },
    });
    if (!existingInstall) {
      await tx.tenantPluginInstall.create({ data: { userId: user.id, deploymentId: deployment.id, status: 'active', enabled: true } });
      await tx.pluginDeployment.update({ where: { id: deployment.id }, data: { activeInstalls: { increment: 1 } } });
    }

    await tx.userPluginPreference.upsert({
      where: { userId_pluginName: { userId: user.id, pluginName: example.name } },
      update: { enabled: true },
      create: { userId: user.id, pluginName: example.name, enabled: true, order: 0, pinned: false },
    });

    return { package: pkg, version };
  });

  // Symlink for local dev only
  if (!IS_VERCEL && /^[a-z0-9][a-z0-9-]*$/.test(example.dirName)) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const fs = require('fs');
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const pathMod = require('path');
      let rootDir = process.cwd();
      for (let i = 0; i < 5; i++) {
        if (fs.existsSync(pathMod.join(rootDir, 'examples'))) break;
        rootDir = pathMod.dirname(rootDir);
      }
      const target = pathMod.join(rootDir, 'plugins', example.dirName);
      const source = pathMod.join(rootDir, 'examples', example.dirName);
      if (!fs.existsSync(target) && fs.existsSync(source)) {
        fs.symlinkSync(source, target, 'dir');
      }
    } catch { /* non-fatal */ }
  }

  return NextResponse.json({ success: true, ...result }, { status: 201 });
}

/**
 * Handle registry/* requests that reach this catch-all.
 * On Vercel, the dedicated registry routes may not take priority.
 */
async function handleRegistryRequest(
  request: NextRequest,
  pathSegments: string[],
): Promise<NextResponse> {
  try {
    // GET /api/v1/registry/examples
    if (pathSegments[0] === 'examples' && pathSegments.length === 1 && request.method === 'GET') {
      return handleListExamples(request);
    }

    // POST /api/v1/registry/examples/:name/publish
    if (
      pathSegments[0] === 'examples' &&
      pathSegments.length === 3 &&
      pathSegments[2] === 'publish' &&
      request.method === 'POST'
    ) {
      return handlePublishExample(request, pathSegments[1]);
    }
  } catch (err) {
    console.error('[registry] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }

  return NextResponse.json(
    { success: false, error: { code: 'NOT_FOUND', message: `/registry/${pathSegments.join('/')} not found` } },
    { status: 404 },
  );
}

// ─── Main handler ───────────────────────────────────────────────────────────

async function handleRequest(
  request: NextRequest,
  { params }: { params: Promise<{ plugin: string; path: string[] }> }
): Promise<NextResponse> {
  const { plugin, path } = await params;

  // Handle registry requests inline (Vercel catch-all routing workaround)
  if (plugin === 'registry') {
    return handleRegistryRequest(request, path);
  }

  if (RESERVED_PREFIXES.has(plugin)) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'ROUTE_MISMATCH',
          message: `/${plugin} has dedicated routes — this catch-all should not handle it`,
        },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 404 }
    );
  }

  // Check if plugin is known
  const serviceUrl = PLUGIN_SERVICES[plugin];

  if (!serviceUrl) {
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'NOT_FOUND',
          message: `Plugin ${plugin} not found`,
        },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 404 }
    );
  }

  // On Vercel (production), localhost services are not available.
  const isVercel = process.env.VERCEL === '1';
  if (isVercel && serviceUrl.includes('localhost')) {
    console.warn(
      `[proxy] Vercel: unhandled route /api/v1/${plugin}/${path.join('/')} (${request.method}). ` +
      `Add a dedicated Next.js route handler for this endpoint.`
    );
    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'NOT_IMPLEMENTED',
          message: `Endpoint /api/v1/${plugin}/${path.join('/')} is not yet available in this environment. ` +
            `A dedicated Next.js route handler is needed.`,
        },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 501 }
    );
  }

  // Build the proxy URL
  const pathString = path.join('/');
  const targetUrl = `${serviceUrl}/api/v1/${pathString}${request.nextUrl.search}`;

  // Build headers for the proxy request
  const headers = new Headers();
  headers.set('Content-Type', request.headers.get('Content-Type') || 'application/json');

  const incomingAuthorization = request.headers.get('authorization');
  if (incomingAuthorization) {
    headers.set('Authorization', incomingAuthorization);
  } else {
    const token = getAuthToken(request);
    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }
  }

  const requestId = request.headers.get('x-request-id');
  if (requestId) headers.set('x-request-id', requestId);

  const traceId = request.headers.get('x-trace-id');
  if (traceId) headers.set('x-trace-id', traceId);

  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) headers.set('x-forwarded-for', forwardedFor);

  const realIp = request.headers.get('x-real-ip');
  if (realIp) headers.set('x-real-ip', realIp);

  const teamId = request.headers.get('x-team-id');
  if (teamId) headers.set('x-team-id', teamId);

  const csrfToken = request.headers.get('x-csrf-token');
  if (csrfToken) headers.set('x-csrf-token', csrfToken);

  try {
    let body: string | undefined;
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      try {
        body = await request.text();
      } catch {
        // No body
      }
    }

    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
    });

    const responseBody = await response.text();

    const responseHeaders: Record<string, string> = {
      'Content-Type': response.headers.get('Content-Type') || 'application/json',
    };
    if (requestId) responseHeaders['x-request-id'] = requestId;
    if (traceId) responseHeaders['x-trace-id'] = traceId;

    return new NextResponse(responseBody, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error(`Proxy error for ${plugin}:`, err);

    return NextResponse.json(
      {
        success: false,
        error: {
          code: 'SERVICE_UNAVAILABLE',
          message: `Plugin service ${plugin} is unavailable`,
        },
        meta: { timestamp: new Date().toISOString() },
      },
      { status: 503 }
    );
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ plugin: string; path: string[] }> }
) {
  return handleRequest(request, context);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ plugin: string; path: string[] }> }
) {
  return handleRequest(request, context);
}

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ plugin: string; path: string[] }> }
) {
  return handleRequest(request, context);
}

export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ plugin: string; path: string[] }> }
) {
  return handleRequest(request, context);
}

export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ plugin: string; path: string[] }> }
) {
  return handleRequest(request, context);
}
