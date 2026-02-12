/**
 * Plugin Upload API Route
 * POST /api/v1/plugin-publisher/upload - Upload a plugin zip package
 */

import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir, readdir, readFile, rm, unlink, cp } from 'fs/promises';
import { createReadStream, existsSync } from 'fs';
import path from 'path';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/tmp/plugin-uploads';
const STATIC_DIR = process.env.STATIC_DIR || '/tmp/plugin-static';
const PLUGIN_PUBLISHER_URL =
  process.env.PLUGIN_PUBLISHER_URL || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';

export const runtime = 'nodejs';

// Disable default body parsing — we handle multipart ourselves
export const dynamic = 'force-dynamic';

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

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('plugin') as File | null;

    if (!file) {
      return errors.badRequest('No file uploaded');
    }

    // Validate file type
    if (!file.name.endsWith('.zip') && file.type !== 'application/zip') {
      return errors.badRequest('Only .zip files are allowed');
    }

    // 50 MB limit
    if (file.size > 50 * 1024 * 1024) {
      return errors.badRequest('File size exceeds 50 MB limit');
    }

    const uploadId = Date.now().toString(36) + Math.random().toString(36).substring(2);
    const extractDir = path.join(UPLOAD_DIR, uploadId);

    // Ensure directories exist
    await mkdir(UPLOAD_DIR, { recursive: true });
    await mkdir(STATIC_DIR, { recursive: true });
    await mkdir(extractDir, { recursive: true });

    // Write uploaded file to disk
    const zipPath = path.join(UPLOAD_DIR, `${uploadId}.zip`);
    const bytes = await file.arrayBuffer();
    await writeFile(zipPath, Buffer.from(bytes));

    // Extract zip using unzipper (dynamic import to handle optional dep)
    try {
      const unzipper = await import('unzipper');
      await new Promise<void>((resolve, reject) => {
        createReadStream(zipPath)
          .pipe(unzipper.Extract({ path: extractDir }))
          .on('close', resolve)
          .on('error', reject);
      });
    } catch {
      // Fallback: use child_process unzip with execFileSync to prevent shell injection
      const { execFileSync } = await import('child_process');
      execFileSync('unzip', ['-o', zipPath, '-d', extractDir], { stdio: 'pipe' });
    }

    // Clean up zip
    await unlink(zipPath);

    // Find plugin.json manifest
    let manifest: Record<string, unknown> | null = null;
    const manifestPath = path.join(extractDir, 'plugin.json');

    if (existsSync(manifestPath)) {
      manifest = JSON.parse(await readFile(manifestPath, 'utf-8'));
    } else {
      // Check one level of subdirectories
      const entries = await readdir(extractDir);
      for (const entry of entries) {
        const subPath = path.join(extractDir, entry, 'plugin.json');
        if (existsSync(subPath)) {
          manifest = JSON.parse(await readFile(subPath, 'utf-8'));
          break;
        }
      }
    }

    if (!manifest) {
      await rm(extractDir, { recursive: true });
      return errors.badRequest('plugin.json not found in uploaded archive');
    }

    // Detect UMD bundle
    const pluginName = manifest.name as string;
    let frontendUrl: string | undefined;
    let deploymentType: 'cdn' | 'unknown' = 'unknown';
    let umdManifest: Record<string, unknown> | undefined;

    const searchDirs = [
      path.join(extractDir, 'frontend', 'dist'),
      path.join(extractDir, 'dist'),
      extractDir,
    ];

    const umdSearchDirs = [
      ...searchDirs.map((d) => path.join(d, 'production')),
      ...searchDirs,
    ];

    for (const dir of umdSearchDirs) {
      if (!existsSync(dir)) continue;

      const files = await readdir(dir);

      // Check for production manifest.json
      if (files.includes('manifest.json')) {
        try {
          const mContent = await readFile(path.join(dir, 'manifest.json'), 'utf-8');
          const prodManifest = JSON.parse(mContent);
          if (prodManifest.bundleFile || prodManifest.globalName) {
            deploymentType = 'cdn';
            umdManifest = prodManifest;

            const staticPath = path.join(STATIC_DIR, uploadId);
            await mkdir(staticPath, { recursive: true });
            await cp(dir, staticPath, { recursive: true });

            const bundleFile =
              prodManifest.bundleFile ||
              files.find((f: string) => f.endsWith('.js') && f.includes(pluginName));
            if (bundleFile) {
              frontendUrl = `${PLUGIN_PUBLISHER_URL}/static/${uploadId}/${bundleFile}`;
            }
            break;
          }
        } catch {
          /* not a valid production manifest */
        }
      }

      // Look for UMD bundle by naming pattern
      const umdBundle = files.find(
        (f: string) => f.endsWith('.js') && !f.endsWith('.map') && pluginName && f.includes(pluginName),
      );
      if (umdBundle) {
        const content = await readFile(path.join(dir, umdBundle), 'utf-8');
        if (content.includes('(function') && content.includes('mount')) {
          deploymentType = 'cdn';
          const staticPath = path.join(STATIC_DIR, uploadId);
          await mkdir(staticPath, { recursive: true });
          await cp(dir, staticPath, { recursive: true });
          frontendUrl = `${PLUGIN_PUBLISHER_URL}/static/${uploadId}/${umdBundle}`;
          break;
        }
      }
    }

    // Clean up extracted files
    await rm(extractDir, { recursive: true });

    return success({
      frontendUrl,
      manifest,
      uploadId,
      deploymentType,
      ...(umdManifest ? { productionManifest: umdManifest } : {}),
    });
  } catch (err) {
    console.error('Upload error:', err);
    return errors.internal('Upload failed');
  }
}
