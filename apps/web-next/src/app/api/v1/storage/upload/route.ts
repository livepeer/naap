/**
 * File Upload Endpoint
 * POST /api/v1/storage/upload
 *
 * Handles file uploads to Vercel Blob or local storage.
 */

import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { validateSession } from '@/lib/api/auth';
import { errors, getAuthToken, success } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

const MAX_FILE_SIZE = 50 * 1024 * 1024; // 50MB
const ALLOWED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'application/pdf',
  'application/zip',
  'application/json',
  'text/plain',
  'text/javascript',
  'text/css',
];

export async function POST(request: NextRequest): Promise<NextResponse> {
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

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get('file') as File | null;

    if (!file) {
      return errors.badRequest('No file provided');
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return errors.badRequest(`File too large. Maximum size is ${MAX_FILE_SIZE / 1024 / 1024}MB`);
    }

    // Validate content type
    if (!ALLOWED_TYPES.includes(file.type)) {
      return errors.badRequest(`File type not allowed: ${file.type}`);
    }

    // Get upload path
    const pathPrefix = formData.get('path') as string || '';
    const fileName = file.name.replace(/[^a-zA-Z0-9.-]/g, '_');
    const uploadPath = pathPrefix ? `${pathPrefix}/${fileName}` : fileName;

    // Check if Vercel Blob is configured
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;

    if (blobToken) {
      // Use Vercel Blob
      const blob = await put(uploadPath, file, {
        access: 'public',
        addRandomSuffix: true,
      });

      return success({
        url: blob.url,
        pathname: blob.pathname,
        contentType: blob.contentType,
        size: file.size,
      });
    }

    // Fall back to local storage for development
    const localStoragePath = process.env.LOCAL_STORAGE_PATH || './storage';
    const fullPath = join(localStoragePath, uploadPath);
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));

    await mkdir(dir, { recursive: true });

    const buffer = Buffer.from(await file.arrayBuffer());
    await writeFile(fullPath, buffer);

    const localUrl = `/api/v1/storage/files/${uploadPath}`;

    return success({
      url: localUrl,
      pathname: uploadPath,
      contentType: file.type,
      size: file.size,
    });
  } catch (err) {
    console.error('Upload error:', err);
    return errors.internal('Failed to upload file');
  }
}

// Handle preflight requests
export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    },
  });
}
