/**
 * Service Gateway — Team Guard
 *
 * Reusable auth + team extraction for admin API routes.
 * - Extracts and validates JWT auth
 * - Resolves teamId from x-team-id header
 * - Provides team-scoped resource loading helpers
 *
 * Returns 404 (not 403) for other teams' resources to prevent enumeration.
 */

import { prisma } from '@/lib/db';
import { getAuthToken } from '@/lib/api/response';
import { errors } from '@/lib/api/response';

const BASE_SVC_URL = process.env.BASE_SVC_URL || process.env.NEXT_PUBLIC_BASE_SVC_URL || 'http://localhost:4000';

export interface AdminContext {
  userId: string;
  teamId: string;
  token: string;
}

/**
 * Extract and validate admin context from request.
 * Returns AdminContext or a NextResponse error.
 */
export async function getAdminContext(
  request: Request
): Promise<AdminContext | Response> {
  const token = getAuthToken(request);
  if (!token) {
    return errors.unauthorized('Authentication required');
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5_000);

    const meResponse = await fetch(`${BASE_SVC_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!meResponse.ok) {
      return errors.unauthorized('Invalid or expired token');
    }

    const me = await meResponse.json();
    const userId = me.data?.id || me.id;
    if (!userId) {
      return errors.unauthorized('Invalid token payload');
    }

    const teamId = request.headers.get('x-team-id');
    if (!teamId) {
      return errors.badRequest('x-team-id header is required');
    }

    return { userId, teamId, token };
  } catch {
    return errors.internal('Auth service unavailable');
  }
}

/**
 * Check if the response is an error (not an AdminContext).
 */
export function isErrorResponse(result: AdminContext | Response): result is Response {
  return result instanceof Response;
}

/**
 * Build a Prisma `where` clause that scopes a connector to the caller's
 * ownership: team-scoped uses `teamId`, personal uses `ownerUserId`.
 */
function scopeFilter(connectorId: string, scopeId: string) {
  if (scopeId.startsWith('personal:')) {
    const userId = scopeId.slice('personal:'.length);
    return { id: connectorId, ownerUserId: userId };
  }
  return { id: connectorId, teamId: scopeId };
}

function visibleFilter(connectorId: string, scopeId: string) {
  return {
    OR: [
      scopeFilter(connectorId, scopeId),
      { id: connectorId, visibility: 'public', status: 'published' },
    ],
  };
}

/**
 * Load a connector by ID, verifying it belongs to the caller's scope
 * OR is a published public connector (visible to all authenticated users).
 */
export async function loadConnector(connectorId: string, scopeId: string) {
  return prisma.serviceConnector.findFirst({
    where: visibleFilter(connectorId, scopeId),
  });
}

/**
 * Load a connector by ID, strictly within the caller's own scope.
 * Use for write operations (update/delete) where public fallback is NOT allowed.
 */
export async function loadOwnedConnector(connectorId: string, scopeId: string) {
  return prisma.serviceConnector.findFirst({
    where: scopeFilter(connectorId, scopeId),
  });
}

/**
 * Load a connector by ID with its endpoints.
 * Same visibility rules as loadConnector.
 */
export async function loadConnectorWithEndpoints(connectorId: string, scopeId: string) {
  return prisma.serviceConnector.findFirst({
    where: visibleFilter(connectorId, scopeId),
    include: { endpoints: true },
  });
}
