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

import {
  PYMTHOUSE_SIGNER_SESSION_TTL_MS,
} from '@/lib/pymthouse-oidc';

const PYMTHOUSE_PROVIDER_SLUG = 'pymthouse';

function computePymthouseExpiry(createdAt: Date): Date {
  return new Date(createdAt.getTime() + PYMTHOUSE_SIGNER_SESSION_TTL_MS);
}

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
      include: {
        billingProvider: {
          select: {
            slug: true,
          },
        },
      },
    });

    if (!apiKey) {
      return errors.notFound('API key');
    }

    if (apiKey.billingProvider?.slug === PYMTHOUSE_PROVIDER_SLUG) {
      const expiredByAge =
        apiKey.status === 'ACTIVE' &&
        computePymthouseExpiry(apiKey.createdAt).getTime() <= Date.now();
      const alreadyExpired = apiKey.status === 'EXPIRED';
      if (expiredByAge || alreadyExpired) {
        await prisma.devApiKey.deleteMany({
          where: { id: apiKey.id },
        });
        return errors.notFound('API key');
      }
    }

    return success({
      key: {
        ...apiKey,
        expiresAt:
          apiKey.billingProvider?.slug === PYMTHOUSE_PROVIDER_SLUG
            ? computePymthouseExpiry(apiKey.createdAt).toISOString()
            : null,
      },
    });
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
    const csrfError = validateCSRF(request, { shadowMode: true });
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
