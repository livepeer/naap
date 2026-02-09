/**
 * Shared utility to extract user ID from a request.
 * Supports both x-user-id header (legacy) and Bearer token auth.
 */

import { Request } from 'express';

type SessionValidator = (token: string) => Promise<{ id: string } | null>;

/**
 * Creates a getUserIdFromRequest function bound to a specific session validator.
 * This allows the auth service to be injected without circular dependencies.
 */
export function createGetUserIdFromRequest(validateSession: SessionValidator) {
  return async function getUserIdFromRequest(req: Request): Promise<string | null> {
    // First check x-user-id header (legacy)
    const headerUserId = req.headers['x-user-id'] as string;
    if (headerUserId) {
      return headerUserId;
    }

    // Check Bearer token
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      const user = await validateSession(token);
      return user?.id || null;
    }

    return null;
  };
}
