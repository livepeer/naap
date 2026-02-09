/**
 * Single Developer API Key Routes
 * GET /api/v1/developer/keys/:id - Get API key details
 * DELETE /api/v1/developer/keys/:id - Revoke API key
 */

import {NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

interface RouteParams {
  params: Promise<{ id: string }>;
}

export async function GET(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;

    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    const apiKey = await prisma.devApiKey.findFirst({
      where: {
        id,
        userId: user.id, // Ensure user owns this key
      },
    });

    if (!apiKey) {
      return errors.notFound('API key');
    }

    return success({ key: apiKey });
  } catch (err) {
    console.error('API key detail error:', err);
    return errors.internal('Failed to get API key');
  }
}

export async function DELETE(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;

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

    // Check if key exists and belongs to user
    const apiKey = await prisma.devApiKey.findFirst({
      where: {
        id,
        userId: user.id,
      },
    });

    if (!apiKey) {
      return errors.notFound('API key');
    }

    // Revoke the key (soft delete)
    const revokedKey = await prisma.devApiKey.update({
      where: { id },
      data: { status: 'REVOKED', revokedAt: new Date() },
    });

    return success({
      message: 'API key revoked',
      key: revokedKey,
    });
  } catch (err) {
    console.error('Revoke API key error:', err);
    return errors.internal('Failed to revoke API key');
  }
}
