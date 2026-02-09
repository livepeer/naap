/**
 * Teams API Routes
 * GET /api/v1/teams - List user's teams
 * POST /api/v1/teams - Create a new team
 */

import { NextRequest } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { createTeam, getUserTeams } from '@/lib/api/teams';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    const teams = await getUserTeams(user.id);

    return success({ teams });
  } catch (err) {
    console.error('Error listing teams:', err);
    return errors.internal('Failed to list teams');
  }
}

export async function POST(request: NextRequest) {
  try {
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
    const { name, slug, description, avatarUrl } = body;

    if (!name || !slug) {
      return errors.badRequest('Name and slug are required');
    }

    // Validate slug format
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return errors.badRequest('Slug must contain only lowercase letters, numbers, and hyphens');
    }

    const team = await createTeam(user.id, {
      name,
      slug,
      description,
      avatarUrl,
    });

    return success({ team }, { timestamp: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to create team';

    if (message.includes('already taken')) {
      return errors.conflict(message);
    }

    return errors.badRequest(message);
  }
}
