/**
 * File Delete Endpoint
 * DELETE /api/v1/storage/delete
 *
 * Deletes files from Vercel Blob or local storage.
 */

import { NextRequest, NextResponse } from 'next/server';
import { del } from '@vercel/blob';
import { validateSession } from '@/lib/api/auth';
import { errors, getAuthToken, success } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';
import { unlink } from 'fs/promises';
import { join } from 'path';

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    // Validate session
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    // Validate CSRF token
    const csrfError = validateCSRF(request, token);
    if (csrfError) {
      return csrfError;
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    const body = await request.json();
    const { url } = body;

    if (!url) {
      return errors.badRequest('No URL provided');
    }

    // Check if Vercel Blob is configured
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;

    if (blobToken) {
      // Delete from Vercel Blob
      await del(url);
      return success({ deleted: true });
    }

    // Fall back to local storage for development
    // Extract path from local URL
    const localPrefix = '/api/v1/storage/files/';
    if (!url.startsWith(localPrefix)) {
      return errors.badRequest('Invalid local storage URL');
    }

    const filePath = url.substring(localPrefix.length);
    const localStoragePath = process.env.LOCAL_STORAGE_PATH || './storage';
    const fullPath = join(localStoragePath, filePath);

    // Security: Prevent path traversal
    if (!fullPath.startsWith(join(process.cwd(), localStoragePath))) {
      return errors.forbidden('Invalid path');
    }

    await unlink(fullPath);
    return success({ deleted: true });
  } catch (err) {
    console.error('Delete error:', err);
    return errors.internal('Failed to delete file');
  }
}

// Handle preflight requests
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
