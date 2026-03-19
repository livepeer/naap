/**
 * Example Plugin Publish API Route
 * POST /api/v1/registry/examples/:name/publish
 *
 * Publishes an example plugin to the marketplace. Uses the pre-generated
 * examples-manifest.json for plugin metadata so the route works on Vercel
 * without runtime filesystem access. Falls back to fs scanning for local dev.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAuthToken } from '@/lib/api/response';
import { validateSession } from '@/lib/api/auth';

const PLUGIN_CDN_URL = process.env.PLUGIN_CDN_URL || '/cdn/plugins';
const IS_VERCEL = process.env.VERCEL === '1';

interface ManifestEntry {
  name: string;
  dirName: string;
  displayName: string;
  description: string;
  category: string;
  author: string;
  authorEmail?: string;
  version: string;
  icon: string;
  routes: string[];
  originalRoutes: string[];
  order: number;
  globalName: string;
  keywords: string[];
  license: string;
  repository: string;
  hasBuild: boolean;
}

function getBundleUrl(cdnBase: string, dirName: string, version: string): string {
  return `${cdnBase}/${dirName}/${version}/${dirName}.js`;
}

function getStylesUrl(cdnBase: string, dirName: string, version: string): string {
  return `${cdnBase}/${dirName}/${version}/${dirName}.css`;
}

/**
 * Find a specific example plugin by camelCase name from the manifest.
 * Falls back to filesystem scanning for local dev.
 */
function findExample(pluginName: string): ManifestEntry | null {
  // Try pre-generated manifest first
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const manifest: ManifestEntry[] = require('../../../../../../../../examples-manifest.json');
    if (Array.isArray(manifest)) {
      return manifest.find((e) => e.name === pluginName) || null;
    }
  } catch {
    // Manifest not available — fall through
  }

  // Fallback: runtime filesystem scanning (local dev only)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    const rootDir = findMonorepoRoot();
    const examplesDir = path.join(rootDir, 'examples');
    if (!fs.existsSync(examplesDir)) return null;

    const dirs = fs.readdirSync(examplesDir).filter(
      (dir: string) => fs.existsSync(path.join(examplesDir, dir, 'plugin.json')),
    );

    for (const dir of dirs) {
      const camelName = dir.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase());
      if (camelName !== pluginName) continue;

      const m = JSON.parse(
        fs.readFileSync(path.join(examplesDir, dir, 'plugin.json'), 'utf8'),
      );
      const rawAuthor = m.author;
      const rawRoutes: string[] = m.frontend?.routes || [];
      const pascalName = camelName.charAt(0).toUpperCase() + camelName.slice(1);

      return {
        dirName: dir,
        name: camelName,
        displayName: m.displayName || dir,
        version: '1.0.0',
        originalRoutes: rawRoutes,
        routes: [`/plugins/${dir}`, `/plugins/${dir}/*`],
        icon: m.frontend?.navigation?.icon || 'Box',
        order: m.frontend?.navigation?.order ?? 99,
        globalName: `NaapPlugin${pascalName}`,
        description: m.description || '',
        author: typeof rawAuthor === 'string' ? rawAuthor : rawAuthor?.name || 'NAAP Examples',
        authorEmail: typeof rawAuthor === 'object' ? rawAuthor?.email : undefined,
        category: m.category || 'example',
        keywords: m.keywords || [],
        license: m.license || 'MIT',
        repository: m.repository || `https://github.com/livepeer/naap/tree/main/examples/${dir}`,
        hasBuild: false,
      };
    }
  } catch {
    // fs not available or failed
  }

  return null;
}

/**
 * Resolve monorepo root. process.cwd() in Next.js is apps/web-next/,
 * so we walk up to find the root package.json with a workspaces field.
 */
function findMonorepoRoot(): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fs = require('fs');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const path = require('path');
  let dir = process.cwd();
  for (let i = 0; i < 5; i++) {
    const pkgPath = path.join(dir, 'package.json');
    if (fs.existsSync(pkgPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        if (pkg.workspaces || fs.existsSync(path.join(dir, 'examples'))) {
          return dir;
        }
      } catch { /* continue */ }
    }
    dir = path.dirname(dir);
  }
  return process.cwd();
}

/**
 * Check if the plugin bundle exists. On Vercel, bundles are in public/cdn/
 * and served statically — the build step already placed them there, so we
 * trust hasBuild from the manifest. Locally we check the filesystem.
 */
function bundleExists(example: ManifestEntry): boolean {
  if (IS_VERCEL) {
    return example.hasBuild;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    const rootDir = findMonorepoRoot();
    const distBundle = path.join(rootDir, 'dist', 'plugins', example.dirName, example.version, `${example.dirName}.js`);
    const publicBundle = path.join(rootDir, 'apps', 'web-next', 'public', 'cdn', 'plugins', example.dirName, example.version, `${example.dirName}.js`);
    return fs.existsSync(distBundle) || fs.existsSync(publicBundle);
  } catch {
    return example.hasBuild;
  }
}

/**
 * Resolve stylesUrl from build manifest. Returns null on Vercel (no fs access)
 * or if no styles file exists locally.
 */
function resolveStylesUrl(example: ManifestEntry): string | null {
  if (IS_VERCEL) return null;

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    const rootDir = findMonorepoRoot();
    const cdnManifest = path.join(rootDir, 'dist', 'plugins', example.dirName, example.version, 'manifest.json');
    const srcManifest = path.join(rootDir, 'plugins', example.dirName, 'frontend', 'dist', 'production', 'manifest.json');
    const manifestPath = fs.existsSync(cdnManifest) ? cdnManifest : fs.existsSync(srcManifest) ? srcManifest : null;
    if (manifestPath) {
      const mf = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      if (mf.stylesFile) {
        return getStylesUrl(PLUGIN_CDN_URL, example.dirName, example.version);
      }
    }
  } catch { /* ignore */ }
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

    const example = findExample(pluginName);
    if (!example) {
      return NextResponse.json(
        { error: 'Example plugin not found' },
        { status: 404 },
      );
    }

    if (!bundleExists(example)) {
      return NextResponse.json(
        {
          error: `Plugin "${example.dirName}" must be built first`,
          hint: `Run: bin/build-plugins.sh --plugin ${example.dirName}`,
        },
        { status: 400 },
      );
    }

    const stylesUrl = resolveStylesUrl(example);
    const bundleUrl = getBundleUrl(PLUGIN_CDN_URL, example.dirName, example.version);

    const result = await prisma.$transaction(async (tx) => {
      const pkgData = {
        name: example.name,
        displayName: example.displayName,
        description: example.description || `${example.displayName} plugin for NAAP`,
        category: example.category || 'other',
        author: example.author || 'NAAP Team',
        authorEmail: example.authorEmail || 'team@naap.io',
        repository: example.repository,
        license: example.license,
        keywords: example.keywords,
        icon: example.icon,
        isCore: false,
        publishStatus: 'published' as const,
      };
      const pkg = await tx.pluginPackage.upsert({
        where: { name: example.name },
        update: { ...pkgData, publishStatus: 'published' },
        create: pkgData,
      });

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

    // Symlink examples/{name} -> plugins/{name} (local dev only, skipped on Vercel)
    if (!IS_VERCEL && /^[a-z0-9][a-z0-9-]*$/.test(example.dirName)) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fs = require('fs');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const path = require('path');
        const rootDir = findMonorepoRoot();
        const symlinkTarget = path.join(rootDir, 'plugins', example.dirName);
        const symlinkSource = path.join(rootDir, 'examples', example.dirName);
        if (!fs.existsSync(symlinkTarget) && fs.existsSync(symlinkSource)) {
          fs.symlinkSync(symlinkSource, symlinkTarget, 'dir');
        }
      } catch {
        // Non-fatal
      }
    }

    return NextResponse.json({ success: true, ...result }, { status: 201 });
  } catch (err) {
    console.error('Publish example error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
