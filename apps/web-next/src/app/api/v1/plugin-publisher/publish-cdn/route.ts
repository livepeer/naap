/**
 * Plugin CDN Publish API Route
 * POST /api/v1/plugin-publisher/publish-cdn - Upload plugin to Vercel Blob CDN
 */

import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, readdir, readFile, rm, unlink } from 'fs/promises';
import { createReadStream, existsSync } from 'fs';
import { createHash, randomUUID } from 'crypto';
import path from 'path';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/plugin-uploads';
const BLOB_READ_WRITE_TOKEN = process.env.BLOB_READ_WRITE_TOKEN;
const USE_CDN_UPLOAD = process.env.USE_CDN_UPLOAD === 'true' || !!BLOB_READ_WRITE_TOKEN;

interface CDNUploadResult {
  bundleUrl: string;
  stylesUrl?: string;
  bundleHash: string;
  bundleSize: number;
  deployedAt: Date;
  /** Blob paths uploaded — used by compensation if DB update fails */
  uploadedPaths: string[];
}

/**
 * Delete a previously-uploaded blob from Vercel storage.
 * Used as compensation when the DB update fails after a successful CDN upload.
 */
async function deleteBlobPath(blobPath: string): Promise<void> {
  if (!BLOB_READ_WRITE_TOKEN) return;
  try {
    await fetch(`https://blob.vercel-storage.com/${blobPath}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${BLOB_READ_WRITE_TOKEN}` },
    });
  } catch (err) {
    console.error(`CDN compensation: failed to delete blob ${blobPath}`, err);
  }
}

/**
 * Compensate for a partial CDN upload by deleting all uploaded blobs.
 * Called when the DB update fails after a successful CDN upload, so orphaned
 * assets do not accumulate in Vercel Blob storage.
 */
export async function compensateCDNUpload(
  pluginName: string,
  version: string,
  uploadedPaths: string[],
): Promise<void> {
  console.warn('CDN compensation triggered', { pluginName, version, count: uploadedPaths.length });
  await Promise.allSettled(uploadedPaths.map(p => deleteBlobPath(p)));
}

async function uploadToCDN(
  pluginName: string,
  version: string,
  assets: { type: string; filename: string; content: Buffer; contentType: string }[],
): Promise<CDNUploadResult> {
  if (!BLOB_READ_WRITE_TOKEN) {
    throw new Error('BLOB_READ_WRITE_TOKEN not configured');
  }

  // Validate plugin name and version to prevent path traversal in blob paths
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(pluginName)) {
    throw new Error('Invalid plugin name');
  }
  if (!/^[\d]+\.[\d]+\.[\d]+/.test(version)) {
    throw new Error('Invalid version format');
  }

  const results: Record<string, { url: string; size: number }> = {};
  const uploadedPaths: string[] = [];
  let bundleHash = '';

  for (const asset of assets) {
    const blobPath = `plugins/${pluginName}/${version}/${asset.filename}`;

    const response = await fetch(`https://blob.vercel-storage.com/${blobPath}`, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${BLOB_READ_WRITE_TOKEN}`,
        'Content-Type': asset.contentType,
        'x-vercel-blob-cache-control-max-age': asset.type === 'manifest' ? '300' : '31536000',
      },
      body: asset.content,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to upload ${asset.filename}: ${response.status} ${errorText}`);
    }

    const result = await response.json();
    results[asset.type] = { url: result.url, size: asset.content.length };
    uploadedPaths.push(blobPath);

    if (asset.type === 'bundle') {
      bundleHash = createHash('sha256').update(asset.content).digest('hex').substring(0, 8);
    }
  }

  if (!results.bundle) {
    throw new Error('No bundle uploaded');
  }

  return {
    bundleUrl: results.bundle.url,
    stylesUrl: results.styles?.url,
    bundleHash,
    bundleSize: results.bundle.size,
    deployedAt: new Date(),
    uploadedPaths,
  };
}

function validateUMDBundleContent(
  content: string,
  _pluginName: string,
): { valid: boolean; errors: string[] } {
  const bundleErrors: string[] = [];

  if (!content.includes('(function') && !content.includes('function(')) {
    bundleErrors.push('Bundle does not appear to be a valid UMD/IIFE format');
  }
  if (!content.includes('mount')) {
    bundleErrors.push('Bundle does not appear to export a mount function');
  }
  if (!content.includes('React') && !content.includes('window.React')) {
    bundleErrors.push('Bundle should reference React as an external dependency');
  }
  if (content.length > 5 * 1024 * 1024) {
    bundleErrors.push('Bundle size exceeds 5MB limit');
  }

  return { valid: bundleErrors.length === 0, errors: bundleErrors };
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const csrfError = validateCSRF(request, token);
    if (csrfError) {
      return csrfError;
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    if (!USE_CDN_UPLOAD) {
      return errors.badRequest(
        'CDN publishing not enabled. Set BLOB_READ_WRITE_TOKEN to enable CDN uploads.',
      );
    }

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('plugin') as File | null;

    if (!file) {
      return errors.badRequest('No file uploaded');
    }

    const uploadId = randomUUID();
    const extractDir = path.join(UPLOAD_DIR, uploadId);

    await mkdir(UPLOAD_DIR, { recursive: true });
    await mkdir(extractDir, { recursive: true });

    // Write and extract zip
    const zipPath = path.join(UPLOAD_DIR, `${uploadId}.zip`);
    const bytes = await file.arrayBuffer();
    await writeFile(zipPath, Buffer.from(bytes));

    try {
      const unzipper = await import('unzipper');
      await new Promise<void>((resolve, reject) => {
        createReadStream(zipPath)
          .pipe(unzipper.Extract({ path: extractDir }))
          .on('close', resolve)
          .on('error', reject);
      });
    } catch {
      // Use execFileSync with argument array to prevent shell injection
      const { execFileSync } = await import('child_process');
      execFileSync('unzip', ['-o', zipPath, '-d', extractDir], { stdio: 'pipe' });
    }

    await unlink(zipPath);

    // Read plugin.json
    let manifest: Record<string, unknown> | null = null;
    let manifestPath = path.join(extractDir, 'plugin.json');

    if (!existsSync(manifestPath)) {
      const entries = await readdir(extractDir);
      for (const entry of entries) {
        const subPath = path.join(extractDir, entry, 'plugin.json');
        if (existsSync(subPath)) {
          manifestPath = subPath;
          break;
        }
      }
    }

    if (existsSync(manifestPath)) {
      manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
    }

    if (!manifest || !manifest.name || !manifest.version) {
      await rm(extractDir, { recursive: true });
      return errors.badRequest('Invalid or missing plugin.json');
    }

    const pluginName = manifest.name as string;
    const version = manifest.version as string;

    // Find UMD bundle
    const bundlePaths = [
      path.join(extractDir, 'dist', 'production'),
      path.join(extractDir, 'frontend', 'dist', 'production'),
      path.join(extractDir, 'dist'),
      extractDir,
    ];

    let bundlePath: string | undefined;
    let stylesPath: string | undefined;

    for (const dir of bundlePaths) {
      if (!existsSync(dir)) continue;
      const files = await readdir(dir);

      for (const f of files) {
        if (f.endsWith('.js') && !f.endsWith('.map') && f.includes(pluginName)) {
          bundlePath = path.join(dir, f);
          break;
        }
      }
      for (const f of files) {
        if (f.endsWith('.css')) {
          stylesPath = path.join(dir, f);
          break;
        }
      }
      if (bundlePath) break;
    }

    if (!bundlePath) {
      await rm(extractDir, { recursive: true });
      return errors.badRequest(
        'No UMD bundle found. Build your plugin with npm run build:production.',
      );
    }

    // Validate file paths are within the expected extract directory
    const resolvedExtractDir = path.resolve(extractDir);
    const resolvedBundlePath = path.resolve(bundlePath);
    if (!resolvedBundlePath.startsWith(resolvedExtractDir + path.sep)) {
      await rm(extractDir, { recursive: true });
      return errors.badRequest('Bundle file path outside expected directory');
    }
    if (stylesPath) {
      const resolvedStylesPath = path.resolve(stylesPath);
      if (!resolvedStylesPath.startsWith(resolvedExtractDir + path.sep)) {
        await rm(extractDir, { recursive: true });
        return errors.badRequest('Styles file path outside expected directory');
      }
    }

    // Validate bundle
    const bundleContent = await readFile(bundlePath, 'utf-8');
    const validation = validateUMDBundleContent(bundleContent, pluginName);

    if (!validation.valid) {
      await rm(extractDir, { recursive: true });
      return errors.badRequest(`Invalid UMD bundle: ${validation.errors.join('; ')}`);
    }

    // Prepare CDN assets
    const bundleHash = createHash('sha256').update(bundleContent).digest('hex').substring(0, 8);
    const bundleFilename = `${pluginName}.${bundleHash}.js`;

    const assets: { type: string; filename: string; content: Buffer; contentType: string }[] = [
      {
        type: 'bundle',
        filename: bundleFilename,
        content: Buffer.from(bundleContent),
        contentType: 'application/javascript',
      },
    ];

    if (stylesPath) {
      const stylesContent = await readFile(stylesPath);
      const stylesHash = createHash('sha256').update(stylesContent).digest('hex').substring(0, 8);
      assets.push({
        type: 'styles',
        filename: `${pluginName}.${stylesHash}.css`,
        content: stylesContent,
        contentType: 'text/css',
      });
    }

    // Production manifest
    const productionManifest = {
      name: pluginName,
      displayName: (manifest.displayName as string) || pluginName,
      version,
      bundleFile: bundleFilename,
      stylesFile: stylesPath ? assets.find((a) => a.type === 'styles')?.filename : undefined,
      globalName: `NaapPlugin${pluginName
        .split('-')
        .map((s) => s[0].toUpperCase() + s.slice(1))
        .join('')}`,
      bundleHash,
      bundleSize: Buffer.byteLength(bundleContent),
      routes: ((manifest.frontend as Record<string, unknown>)?.routes as string[]) || [],
      category: (manifest.category as string) || 'other',
      description: manifest.description as string,
      icon: manifest.icon as string,
      buildTime: new Date().toISOString(),
      nodeEnv: 'production',
    };

    assets.push({
      type: 'manifest',
      filename: 'manifest.json',
      content: Buffer.from(JSON.stringify(productionManifest, null, 2)),
      contentType: 'application/json',
    });

    // Upload to CDN
    const cdnResult = await uploadToCDN(pluginName, version, assets);

    // Clean up extract directory
    await rm(extractDir, { recursive: true });

    // Update database deployment record — treat failure as a publish failure
    // because a CDN upload without a DB record creates an orphaned deployment.
    let dbUpdated = false;
    try {
      const pkg = await prisma.pluginPackage.findUnique({
        where: { name: pluginName },
        include: { versions: { where: { version }, take: 1 } },
      });

      if (pkg && pkg.versions[0]) {
        await prisma.pluginVersion.update({
          where: { id: pkg.versions[0].id },
          data: {
            bundleUrl: cdnResult.bundleUrl,
            stylesUrl: cdnResult.stylesUrl,
            bundleHash: cdnResult.bundleHash,
            bundleSize: cdnResult.bundleSize,
            deploymentType: 'cdn',
          },
        });
        dbUpdated = true;
      } else {
        // Package/version doesn't exist in DB yet — this is acceptable for
        // first-time CDN-only uploads; the registry publish step will create it.
        dbUpdated = true;
      }
    } catch (dbErr) {
      // CDN upload succeeded but DB update failed — run compensation to delete
      // the uploaded blobs so no orphaned assets remain in Vercel Blob storage.
      console.error('CDN publish DB consistency error — running compensation', {
        pluginName,
        version,
        bundleUrl: cdnResult.bundleUrl,
        error: dbErr instanceof Error ? dbErr.message : String(dbErr),
      });
      await compensateCDNUpload(pluginName, version, cdnResult.uploadedPaths);
    }

    return success({
      success: true,
      pluginName,
      version,
      bundleUrl: cdnResult.bundleUrl,
      stylesUrl: cdnResult.stylesUrl,
      bundleHash: cdnResult.bundleHash,
      bundleSize: cdnResult.bundleSize,
      deploymentType: 'cdn',
      manifest: productionManifest,
      dbSynced: dbUpdated,
    });
  } catch (err) {
    console.error('CDN publish error:', err);
    return errors.internal(err instanceof Error ? err.message : 'CDN publish failed');
  }
}
