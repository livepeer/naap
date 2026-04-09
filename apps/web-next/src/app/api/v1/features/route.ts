/**
 * Public Features API
 * GET /api/v1/features - Returns all feature flags as a key:boolean map
 *
 * Authenticated (requires session) but not admin-only.
 * Clients use this to gate UI features based on admin-configured flags.
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

    await ensureKnownFlags();

    const allFlags = await prisma.featureFlag.findMany({
      select: { key: true, enabled: true },
    });

    const flags: Record<string, boolean> = {};
    for (const f of allFlags) {
      flags[f.key] = f.enabled;
    }

    return success({ flags });
  } catch (err) {
    console.error('Error fetching features:', err);
    return errors.internal('Failed to fetch features');
  }
}
