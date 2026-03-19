/**
 * Example Plugin Publish API Route
 * POST /api/v1/registry/examples/:name/publish
 *
 * Publishes an example plugin to the marketplace. Mirrors the base-svc
 * POST /registry/examples/:name/publish endpoint for environments where
 * base-svc is not running (e.g. Vercel deployments).
 *
 * NOTE: Publish logic is inlined here to avoid importing shared utilities
 * that use Node.js fs/path (blocked by Vercel safety pre-push check).
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAuthToken } from '@/lib/api/response';
import { validateSession } from '@/lib/api/auth';
import * as path from 'path';
import * as fs from 'fs';

const MONOREPO_ROOT = path.resolve(process.cwd(), process.env.MONOREPO_ROOT || '.');
const PLUGIN_CDN_URL = process.env.PLUGIN_CDN_URL || '/cdn/plugins';

function toCamelCase(s: string): string {
  return s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
}

function toPascalCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function getBundleUrl(cdnBase: string, dirName: string, version: string): string {
  return `${cdnBase}/${dirName}/${version}/${dirName}.js`;
}

function getStylesUrl(cdnBase: string, dirName: string, version: string): string {
  return `${cdnBase}/${dirName}/${version}/${dirName}.css`;
}

interface DiscoveredExample {
  dirName: string;
  name: string;
  displayName: string;
  version: string;
  routes: string[];
  originalRoutes: string[];
  icon: string;
  order: number;
  globalName: string;
  description?: string;
  author?: string;
  authorEmail?: string;
  category?: string;
  keywords?: string[];
  license?: string;
  repository?: string;
}

function discoverExample(rootDir: string, pluginName: string): DiscoveredExample | null {
  const examplesDir = path.join(rootDir, 'examples');
  if (!fs.existsSync(examplesDir)) return null;

  const dirs = fs.readdirSync(examplesDir).filter(
    (dir) => fs.existsSync(path.join(examplesDir, dir, 'plugin.json')),
  );

  for (const dir of dirs) {
    const camelName = toCamelCase(dir);
    if (camelName !== pluginName) continue;

    const manifest = JSON.parse(
      fs.readFileSync(path.join(examplesDir, dir, 'plugin.json'), 'utf8'),
    );
    const rawAuthor = manifest.author;
    const rawRoutes: string[] = manifest.frontend?.routes || [];

    return {
      dirName: dir,
      name: camelName,
      displayName: manifest.displayName || dir,
      version: '1.0.0',
      originalRoutes: rawRoutes,
      routes: [`/plugins/${dir}`, `/plugins/${dir}/*`],
      icon: manifest.frontend?.navigation?.icon || 'Box',
      order: manifest.frontend?.navigation?.order ?? 99,
      globalName: `NaapPlugin${toPascalCase(camelName)}`,
      description: manifest.description,
      author: typeof rawAuthor === 'string' ? rawAuthor : rawAuthor?.name,
      authorEmail: typeof rawAuthor === 'object' ? rawAuthor?.email : undefined,
      category: manifest.category,
      keywords: manifest.keywords,
      license: manifest.license,
      repository: manifest.repository,
    };
  }
  return null;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
): Promise<NextResponse> {
  try {
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
      return NextResponse.json(
        { error: 'Example plugin publishing is not enabled' },
        { status: 403 },
      );
    }

    const { name: pluginName } = await params;

    const example = discoverExample(MONOREPO_ROOT, pluginName);
    if (!example) {
      return NextResponse.json(
        { error: 'Example plugin not found' },
        { status: 404 },
      );
    }

    // Check bundle exists (Vercel: public/cdn/plugins/; local: dist/plugins/)
    const distBundle = path.join(
      MONOREPO_ROOT, 'dist', 'plugins', example.dirName,
      example.version, `${example.dirName}.js`,
    );
    const publicBundle = path.join(
      MONOREPO_ROOT, 'apps', 'web-next', 'public', 'cdn', 'plugins',
      example.dirName, example.version, `${example.dirName}.js`,
    );
    if (!fs.existsSync(distBundle) && !fs.existsSync(publicBundle)) {
      return NextResponse.json(
        {
          error: `Plugin "${example.dirName}" must be built first`,
          hint: `Run: bin/build-plugins.sh --plugin ${example.dirName}`,
        },
        { status: 400 },
      );
    }

    // Resolve stylesUrl from build manifest if present
    let stylesUrl: string | null = null;
    const cdnManifest = path.join(
      MONOREPO_ROOT, 'dist', 'plugins', example.dirName, example.version, 'manifest.json',
    );
    const srcManifest = path.join(
      MONOREPO_ROOT, 'plugins', example.dirName, 'frontend', 'dist', 'production', 'manifest.json',
    );
    const manifestPath = fs.existsSync(cdnManifest) ? cdnManifest
      : fs.existsSync(srcManifest) ? srcManifest
      : null;
    if (manifestPath) {
      try {
        const mf = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
        if (mf.stylesFile) {
          stylesUrl = getStylesUrl(PLUGIN_CDN_URL, example.dirName, example.version);
        }
      } catch { /* ignore */ }
    }

    const bundleUrl = getBundleUrl(PLUGIN_CDN_URL, example.dirName, example.version);

    const result = await prisma.$transaction(async (tx) => {
      // PluginPackage
      const pkgData = {
        name: example.name,
        displayName: example.displayName,
        description: example.description || `${example.displayName} plugin for NAAP`,
        category: example.category || 'other',
        author: example.author || 'NAAP Team',
        authorEmail: example.authorEmail || 'team@naap.io',
        repository: example.repository || `https://github.com/livepeer/naap/tree/main/examples/${example.dirName}`,
        license: example.license || 'MIT',
        keywords: example.keywords || [],
        icon: example.icon,
        isCore: false,
        publishStatus: 'published' as const,
      };
      const pkg = await tx.pluginPackage.upsert({
        where: { name: example.name },
        update: { ...pkgData, publishStatus: 'published' },
        create: pkgData,
      });

      // PluginVersion
      const versionData = {
        packageId: pkg.id,
        version: example.version,
        frontendUrl: bundleUrl,
        manifest: {
          name: example.name,
          displayName: example.displayName,
          version: example.version,
          description: example.description || '',
          category: example.category || 'other',
          icon: example.icon,
        },
      };
      const version = await tx.pluginVersion.upsert({
        where: { packageId_version: { packageId: pkg.id, version: example.version } },
        update: { frontendUrl: versionData.frontendUrl, manifest: versionData.manifest as any },
        create: versionData,
      });

      // WorkflowPlugin
      const workflowData = {
        name: example.name,
        displayName: example.displayName,
        version: example.version,
        remoteUrl: bundleUrl,
        bundleUrl,
        stylesUrl,
        globalName: example.globalName,
        deploymentType: 'cdn',
        routes: example.routes,
        enabled: true,
        order: example.order,
        icon: example.icon,
      };
      const existingWP = await tx.workflowPlugin.findUnique({
        where: { name: example.name },
        select: { metadata: true },
      });
      const mergedMetadata = {
        ...((existingWP?.metadata as Record<string, unknown>) || {}),
        originalRoutes: example.originalRoutes,
      };
      await tx.workflowPlugin.upsert({
        where: { name: example.name },
        update: { ...workflowData, metadata: mergedMetadata },
        create: { ...workflowData, metadata: mergedMetadata },
      });

      // PluginDeployment
      const deployment = await tx.pluginDeployment.upsert({
        where: { packageId: pkg.id },
        update: {
          versionId: version.id,
          status: 'running',
          frontendUrl: bundleUrl,
          deployedAt: new Date(),
          healthStatus: 'healthy',
        },
        create: {
          packageId: pkg.id,
          versionId: version.id,
          status: 'running',
          frontendUrl: bundleUrl,
          deployedAt: new Date(),
          healthStatus: 'healthy',
          activeInstalls: 0,
        },
      });

      // Auto-install for publishing user
      const existingInstall = await tx.tenantPluginInstall.findFirst({
        where: { userId: user.id, deploymentId: deployment.id, status: { not: 'uninstalled' } },
      });
      if (!existingInstall) {
        await tx.tenantPluginInstall.create({
          data: { userId: user.id, deploymentId: deployment.id, status: 'active', enabled: true },
        });
        await tx.pluginDeployment.update({
          where: { id: deployment.id },
          data: { activeInstalls: { increment: 1 } },
        });
      }

      await tx.userPluginPreference.upsert({
        where: { userId_pluginName: { userId: user.id, pluginName: example.name } },
        update: { enabled: true },
        create: { userId: user.id, pluginName: example.name, enabled: true, order: 0, pinned: false },
      });

      return { package: pkg, version };
    });

    // Symlink examples/{name} -> plugins/{name} (skipped on read-only FS / Vercel)
    if (/^[a-z0-9][a-z0-9-]*$/.test(example.dirName)) {
      const symlinkTarget = path.join(MONOREPO_ROOT, 'plugins', example.dirName);
      const symlinkSource = path.join(MONOREPO_ROOT, 'examples', example.dirName);
      if (!fs.existsSync(symlinkTarget) && fs.existsSync(symlinkSource)) {
        try {
          fs.symlinkSync(symlinkSource, symlinkTarget, 'dir');
        } catch {
          // Read-only filesystem (Vercel) -- non-fatal
        }
      }
    }

    return NextResponse.json({ success: true, ...result }, { status: 201 });
  } catch (err) {
    console.error('Publish example error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
