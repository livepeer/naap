/**
 * File List Endpoint
 * GET /api/v1/storage/list
 *
 * Lists files from Vercel Blob or local storage.
 */

import { NextRequest } from 'next/server';
import { list } from '@vercel/blob';
import { validateSession } from '@/lib/api/auth';
import { errors, getAuthToken, success } from '@/lib/api/response';
import { readdir, stat } from 'fs/promises';
import { join } from 'path';
import { lookup } from 'mime-types';

export async function GET(request: NextRequest) {
  try {
    // Validate session
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    const { searchParams } = new URL(request.url);
    const prefix = searchParams.get('prefix') || undefined;
    const cursor = searchParams.get('cursor') || undefined;
    const limit = parseInt(searchParams.get('limit') || '100', 10);

    // Check if Vercel Blob is configured
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;

    if (blobToken) {
      // List from Vercel Blob
      const result = await list({ prefix, cursor, limit });

      return success({
        files: result.blobs.map(blob => ({
          url: blob.url,
          pathname: blob.pathname,
          size: blob.size,
          uploadedAt: blob.uploadedAt,
        })),
        cursor: result.cursor,
        hasMore: result.hasMore,
      });
    }

    // Fall back to local storage for development
    const localStoragePath = process.env.LOCAL_STORAGE_PATH || './storage';
    const searchPath = prefix ? join(localStoragePath, prefix) : localStoragePath;

    try {
      const entries = await readdir(searchPath, { withFileTypes: true, recursive: true });
      const files = await Promise.all(
        entries
          .filter(entry => entry.isFile() && !entry.name.endsWith('.meta.json'))
          .slice(0, limit)
          .map(async entry => {
            const filePath = join(entry.parentPath || entry.path, entry.name);
            const relativePath = filePath.replace(localStoragePath + '/', '');
            const fileStat = await stat(filePath);

            return {
              url: `/api/v1/storage/files/${relativePath}`,
              pathname: relativePath,
              size: fileStat.size,
              contentType: lookup(entry.name) || 'application/octet-stream',
              uploadedAt: fileStat.mtime.toISOString(),
            };
          })
      );

      return success({
        files,
        cursor: null,
        hasMore: false,
      });
    } catch {
      // Directory doesn't exist or is empty
      return success({
        files: [],
        cursor: null,
        hasMore: false,
      });
    }
  } catch (err) {
    console.error('List error:', err);
    return errors.internal('Failed to list files');
  }
}
