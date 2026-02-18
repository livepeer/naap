/**
 * CDN Plugin Bundle Server
 *
 * Serves UMD plugin bundles from same origin as the shell.
 * This enables camera/microphone permissions to work properly
 * since the plugin code runs in the same origin context.
 *
 * Routes:
 *   GET /cdn/plugins/:pluginName/:version/:file
 *
 * Example:
 *   GET /cdn/plugins/daydream-video/1.0.0/daydream-video.js
 *   GET /cdn/plugins/daydream-video/1.0.0/daydream-video.css (auto-finds actual CSS file)
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFile, stat, readdir } from 'fs/promises';
import path from 'path';

/**
 * Converts a camelCase plugin name to kebab-case directory name.
 * All plugin directories use kebab-case; DB names are camelCase.
 *
 * Examples:
 *   gatewayManager  -> gateway-manager
 *   marketplace     -> marketplace
 *   myWallet        -> my-wallet
 */
function toKebabCase(name: string): string {
  return name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase();
}

// MIME types for plugin assets
const MIME_TYPES: Record<string, string> = {
  '.js': 'application/javascript',
  '.css': 'text/css',
  '.map': 'application/json',
  '.json': 'application/json',
};

// Security: Only allow these file extensions
const ALLOWED_EXTENSIONS = ['.js', '.css', '.map', '.json'];

interface RouteParams {
  params: Promise<{
    pluginName: string;
    version: string;
    file: string[];
  }>;
}

export async function GET(
  request: NextRequest,
  { params }: RouteParams
): Promise<NextResponse> {
  const resolvedParams = await params;
  const { pluginName, version, file } = resolvedParams;
  const fileName = file.join('/');

  // Security: Validate pluginName and version segments (prevent path traversal)
  const isValidPlugin = /^[a-zA-Z0-9-_]+$/.test(pluginName) && pluginName !== '.' && pluginName !== '..';
  const isValidVersion = /^[0-9A-Za-z.-]+$/.test(version) && version !== '.' && version !== '..';
  if (!isValidPlugin || !isValidVersion) {
    return NextResponse.json(
      { error: 'Invalid plugin name or version' },
      { status: 400 }
    );
  }

  // Security: Validate file extension
  const ext = path.extname(fileName).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return NextResponse.json(
      { error: 'File type not allowed' },
      { status: 403 }
    );
  }

  // Security: Prevent directory traversal
  if (fileName.includes('..') || fileName.includes('//')) {
    return NextResponse.json(
      { error: 'Invalid file path' },
      { status: 400 }
    );
  }

  // Resolve plugin directory: deterministic camelCase → kebab-case conversion
  // No hardcoded map needed — all plugin directories follow this convention
  const pluginDir = toKebabCase(pluginName);

  // Build the file path
  // In development: ../../../dist/plugins/[pluginDir]/[version]/[file]
  // In production: could be Vercel Blob or local storage
  const rootDir = process.cwd();
  const versionDir = path.join(rootDir, '..', '..', 'dist', 'plugins', pluginDir, version);
  let distPath = path.join(versionDir, fileName);

  try {
    // For CSS files, handle dynamic naming
    // Plugin CSS files have inconsistent names (style.css, plugin-name-frontend.css, etc.)
    if (ext === '.css') {
      try {
        await stat(distPath);
      } catch {
        // File with exact name doesn't exist, find the actual CSS file
        const files = await readdir(versionDir);
        const cssFile = files.find(f => f.endsWith('.css'));
        if (cssFile) {
          distPath = path.join(versionDir, cssFile);
        }
      }
    }

    // Read the file directly (avoid TOCTOU race condition)
    const content = await readFile(distPath);

    // Get MIME type
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    // Create response with appropriate headers
    const response = new NextResponse(content, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': process.env.NODE_ENV === 'production'
          ? 'public, max-age=0, must-revalidate'  // Revalidate on each request until content-hash versioning is added
          : 'no-cache',  // No caching in development
        'X-Content-Type-Options': 'nosniff',
      },
    });

    return response;
  } catch (error) {
    // File not found
    return NextResponse.json(
      {
        error: 'Plugin bundle not found',
        plugin: pluginName,
        version,
        file: fileName,
        path: distPath,
      },
      { status: 404 }
    );
  }
}
