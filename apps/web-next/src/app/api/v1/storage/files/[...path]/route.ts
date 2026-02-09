/**
 * Local File Serving Endpoint (Development Only)
 * GET /api/v1/storage/files/[...path]
 *
 * Serves files from local storage in development mode.
 */

import { NextRequest, NextResponse } from 'next/server';
import { readFile, stat } from 'fs/promises';
import { join } from 'path';
import { lookup } from 'mime-types';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  // Only allow in development
  if (process.env.NODE_ENV === 'production' && process.env.BLOB_READ_WRITE_TOKEN) {
    return new NextResponse('Not Found', { status: 404 });
  }

  try {
    const { path } = await params;
    const filePath = path.join('/');
    const localStoragePath = process.env.LOCAL_STORAGE_PATH || './storage';
    const fullPath = join(localStoragePath, filePath);

    // Security: Prevent path traversal
    if (!fullPath.startsWith(join(process.cwd(), localStoragePath))) {
      return new NextResponse('Forbidden', { status: 403 });
    }

    const fileBuffer = await readFile(fullPath);
    const fileStat = await stat(fullPath);
    const contentType = lookup(filePath) || 'application/octet-stream';

    return new NextResponse(fileBuffer, {
      headers: {
        'Content-Type': contentType,
        'Content-Length': fileStat.size.toString(),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Last-Modified': fileStat.mtime.toUTCString(),
      },
    });
  } catch (err) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      return new NextResponse('Not Found', { status: 404 });
    }
    console.error('File serve error:', err);
    return new NextResponse('Internal Server Error', { status: 500 });
  }
}
