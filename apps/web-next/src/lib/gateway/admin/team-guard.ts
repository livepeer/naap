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

  // Validate JWT via base-svc
  try {
    const meResponse = await fetch(`${BASE_SVC_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

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
 * Load a connector by ID, verifying it belongs to the caller's team.
 * Returns 404 for other teams' connectors (prevents enumeration).
 */
export async function loadConnector(connectorId: string, teamId: string) {
  const connector = await prisma.serviceConnector.findFirst({
    where: { id: connectorId, teamId },
  });
  return connector;
}

/**
 * Load a connector by ID with its endpoints.
 */
export async function loadConnectorWithEndpoints(connectorId: string, teamId: string) {
  const connector = await prisma.serviceConnector.findFirst({
    where: { id: connectorId, teamId },
    include: { endpoints: true },
  });
  return connector;
}
