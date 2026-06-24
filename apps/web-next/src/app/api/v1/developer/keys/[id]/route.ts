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

/**
 * Strip credential-derived material (`keyHash`, `keyLookupId`) before
 * returning a DevApiKey to the client. See `route.ts` for rationale.
 */
function toSafeDevApiKey<
  T extends {
    keyHash?: unknown;
    keyLookupId?: unknown;
  },
>(key: T): Omit<T, 'keyHash' | 'keyLookupId'> {
  const { keyHash: _keyHash, keyLookupId: _keyLookupId, ...rest } = key;
  return rest;
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

    // Hide EXPIRED PymtHouse keys so this single-key endpoint stays consistent
    // with the list endpoint (which filters them) and the plugin backend GET
    // /:id handler (which 404s them). Non-PymtHouse keys are unaffected.
    if (apiKey.billingProvider?.slug === 'pymthouse' && apiKey.status === 'EXPIRED') {
      return errors.notFound('API key');
    }

    return success({
      key: {
        ...toSafeDevApiKey(apiKey),
        expiresAt: null,
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

    const csrfError = validateCSRF(request);
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
      key: toSafeDevApiKey(revokedKey),
    });
  } catch (err) {
    console.error('Revoke API key error:', err);
    return errors.internal('Failed to revoke API key');
  }
}
