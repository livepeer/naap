/**
 * Transfer Team Ownership
 * POST /api/v1/teams/:teamId/transfer-ownership
 */

import { NextRequest } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { transferOwnership } from '@/lib/api/teams';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

interface RouteParams {
  params: Promise<{ teamId: string }>;
}

export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const { teamId } = await params;

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
    const { newOwnerId } = body;

    if (!newOwnerId) {
      return errors.badRequest('New owner ID is required');
    }

    await transferOwnership(teamId, newOwnerId, user.id);

    return success({ message: 'Ownership transferred' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to transfer ownership';
    return errors.badRequest(message);
  }
}
