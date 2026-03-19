/**
 * Example Plugin Publish API Route
 * POST /api/v1/registry/examples/:name/publish
 *
 * Publishes an example plugin to the marketplace. Uses the generated
 * TypeScript manifest (src/generated/examples-manifest.ts) for plugin
 * metadata, guaranteeing the data is available on Vercel.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { getAuthToken } from '@/lib/api/response';
import { validateSession } from '@/lib/api/auth';
import { EXAMPLES_MANIFEST, type ExampleManifestEntry } from '../../../../../../generated/examples-manifest';

const PLUGIN_CDN_URL = process.env.PLUGIN_CDN_URL || '/cdn/plugins';
const IS_VERCEL = process.env.VERCEL === '1';

function getBundleUrl(cdnBase: string, dirName: string, version: string): string {
  return `${cdnBase}/${dirName}/${version}/${dirName}.js`;
}

function findExample(pluginName: string): ExampleManifestEntry | null {
  return EXAMPLES_MANIFEST.find((e) => e.name === pluginName) || null;
}

function bundleExists(example: ExampleManifestEntry): boolean {
  if (IS_VERCEL) {
    return example.hasBuild;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const fs = require('fs');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const path = require('path');
    let rootDir = process.cwd();
    for (let i = 0; i < 5; i++) {
      if (fs.existsSync(path.join(rootDir, 'examples'))) break;
      rootDir = path.dirname(rootDir);
    }
    const distBundle = path.join(rootDir, 'dist', 'plugins', example.dirName, example.version, `${example.dirName}.js`);
    const publicBundle = path.join(rootDir, 'apps', 'web-next', 'public', 'cdn', 'plugins', example.dirName, example.version, `${example.dirName}.js`);
    return fs.existsSync(distBundle) || fs.existsSync(publicBundle);
  } catch {
    return example.hasBuild;
  }
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
        stylesUrl: null as string | null,
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

    // Symlink examples/{name} -> plugins/{name} (local dev only)
    if (!IS_VERCEL && /^[a-z0-9][a-z0-9-]*$/.test(example.dirName)) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const fs = require('fs');
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const path = require('path');
        let rootDir = process.cwd();
        for (let i = 0; i < 5; i++) {
          if (fs.existsSync(path.join(rootDir, 'examples'))) break;
          rootDir = path.dirname(rootDir);
        }
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
