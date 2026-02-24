/**
 * Service Gateway — Admin Context Guard
 *
 * Reusable auth + scope extraction for admin API routes.
 *
 * Uses the shell's own `validateSession()` to verify tokens directly
 * against the database — no HTTP round-trip to base-svc. This ensures:
 *   - Correct API path (no /api/auth/me vs /api/v1/auth/me mismatch)
 *   - Correct response shape (typed AuthUser, not ad-hoc JSON parsing)
 *   - Lower latency (DB query vs HTTP call)
 *
 * Supports two modes:
 *   - Team scope:     x-team-id header present → data scoped to team.
 *   - Personal scope: no x-team-id header     → data scoped to personal:{userId}.
 *
 * Returns 404 (not 403) for other scopes' resources to prevent enumeration.
 */

import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { getAuthToken, errors } from '@/lib/api/response';

export interface AdminContext {
  userId: string;
  /** teamId when in team scope, or `personal:{userId}` in personal scope */
  teamId: string;
  token: string;
  /** Whether the user is in personal scope (no team selected) */
  isPersonal: boolean;
}

/**
 * Extract and validate admin context from request.
 *
 * Supports two modes:
 * - **Team scope**: `x-team-id` header is present → data scoped to the team.
 * - **Personal scope**: no `x-team-id` header → data scoped to `personal:{userId}`.
 *
 * Returns AdminContext or a NextResponse error.
 */
export async function getAdminContext(
  request: Request
): Promise<AdminContext | Response> {
  const token = getAuthToken(request);
  if (!token) {
    return errors.unauthorized('Authentication required');
  }

  // Validate session directly against the database (no HTTP round-trip).
  // validateSession returns a typed AuthUser or null.
  const user = await validateSession(token);
  if (!user) {
    return errors.unauthorized('Invalid or expired token');
  }

  const headerTeamId = request.headers.get('x-team-id');

  if (headerTeamId) {
    // Team scope
    return { userId: user.id, teamId: headerTeamId, token, isPersonal: false };
  }

  // Personal scope — deterministic identifier scoped to this user
  return { userId: user.id, teamId: `personal:${user.id}`, token, isPersonal: true };
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
