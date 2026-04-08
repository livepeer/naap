/**
 * Admin Feature Flags API
 * GET  /api/v1/admin/feature-flags - List all feature flags (admin only)
 * PUT  /api/v1/admin/feature-flags - Create or update a feature flag by key (admin only)
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { ensureKnownFlags } from '@/lib/feature-flags';

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const sessionUser = await validateSession(token);
    if (!sessionUser) {
      return errors.unauthorized('Invalid or expired session');
    }

    if (!sessionUser.roles.includes('system:admin')) {
      return errors.forbidden('Admin permission required');
    }

    await ensureKnownFlags();

    const flags = await prisma.featureFlag.findMany({
      orderBy: { key: 'asc' },
    });

    return success({ flags });
  } catch (err) {
    console.error('Error fetching feature flags:', err);
    return errors.internal('Failed to fetch feature flags');
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const sessionUser = await validateSession(token);
    if (!sessionUser) {
      return errors.unauthorized('Invalid or expired session');
    }

    if (!sessionUser.roles.includes('system:admin')) {
      return errors.forbidden('Admin permission required');
    }

    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return errors.badRequest('Malformed JSON body');
    }

    const { key, enabled } = body;

    if (!key || typeof key !== 'string') {
      return errors.badRequest('Flag key is required');
    }
    if (typeof enabled !== 'boolean') {
      return errors.badRequest('enabled must be a boolean');
    }

    const description = typeof body.description === 'string' ? body.description : null;

    const flag = await prisma.featureFlag.upsert({
      where: { key },
      update: { enabled, description },
      create: {
        key,
        enabled,
        description,
      },
    });

    return success({ flag });
  } catch (err) {
    console.error('Error updating feature flag:', err);
    return errors.internal('Failed to update feature flag');
  }
}
