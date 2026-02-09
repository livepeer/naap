/**
 * Auth Middleware
 *
 * Validates auth tokens by calling the auth service's /api/v1/auth/me endpoint.
 * Supports both opaque session tokens and JWTs.
 * Attaches user info to the request object.
 *
 * IMPORTANT: Token validation must go to the SAME auth system that issued the
 * token. In the NaaP architecture:
 * - Browser users authenticate via the shell (web-next on port 3000)
 * - web-next creates sessions in its own database
 * - Plugin backends must validate tokens against web-next, NOT base-svc
 *   (which uses a separate database)
 *
 * Priority: SHELL_URL > AUTH_SERVICE_URL > BASE_SVC_URL > http://localhost:3000
 */

import type { Request, Response, NextFunction } from 'express';

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email?: string;
    role?: string;
    roles?: string[];
  };
  teamId?: string;
}

interface AuthMiddlewareConfig {
  secret: string;
  publicPaths?: string[];
  /** Auth service URL for token validation.
   *  Defaults to SHELL_URL or http://localhost:3000 (web-next shell).
   *  The shell is the source of truth for browser auth tokens. */
  authServiceUrl?: string;
  /** @deprecated Use authServiceUrl instead */
  baseSvcUrl?: string;
}

// In-memory session cache to avoid hitting auth service on every request
// Cache entries expire after 60 seconds
const sessionCache = new Map<string, { user: AuthenticatedRequest['user']; expiresAt: number }>();
const CACHE_TTL_MS = 60_000; // 60 seconds

function getCachedSession(token: string): AuthenticatedRequest['user'] | null {
  const entry = sessionCache.get(token);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    sessionCache.delete(token);
    return null;
  }
  return entry.user;
}

function setCachedSession(token: string, user: AuthenticatedRequest['user']): void {
  sessionCache.set(token, { user, expiresAt: Date.now() + CACHE_TTL_MS });

  // Periodically clean up expired entries (every 100 sets)
  if (sessionCache.size % 100 === 0) {
    const now = Date.now();
    for (const [key, val] of sessionCache) {
      if (now > val.expiresAt) sessionCache.delete(key);
    }
  }
}

/**
 * Extract user data from auth service response.
 * Handles multiple response formats:
 * - web-next: { success: true, data: { user: {...} } }
 * - base-svc: { user: {...} }
 * - direct:   { id, email, roles }
 */
function extractUserFromResponse(
  data: Record<string, unknown>
): { id: string; email?: string; roles?: string[] } | null {
  // web-next format: { success: true, data: { user: { id, email, ... } } }
  const nested = data?.data as Record<string, unknown> | undefined;
  if (nested?.user) {
    const u = nested.user as Record<string, unknown>;
    if (u.id) return { id: u.id as string, email: u.email as string | undefined, roles: u.roles as string[] | undefined };
  }

  // base-svc format: { user: { id, email, roles } }
  if (data?.user) {
    const u = data.user as Record<string, unknown>;
    if (u.id) return { id: u.id as string, email: u.email as string | undefined, roles: u.roles as string[] | undefined };
  }

  // direct format: { id, email, roles }
  if (data?.id) {
    return { id: data.id as string, email: data.email as string | undefined, roles: data.roles as string[] | undefined };
  }

  return null;
}

/**
 * Creates auth middleware that validates tokens against the auth service.
 *
 * Token validation strategy:
 * 1. Check in-memory cache (avoids auth service call on every request)
 * 2. If token looks like a JWT (3 dot-separated parts), try local decode first
 * 3. Otherwise, validate against auth service /api/v1/auth/me
 * 4. Also accepts x-user-id header as fallback (for service-to-service calls)
 */
export function createAuthMiddleware(config: AuthMiddlewareConfig) {
  const { publicPaths = ['/healthz'] } = config;

  // Determine the auth service URL:
  // 1. Explicit config
  // 2. SHELL_URL env var (preferred - the shell issued the token)
  // 3. AUTH_SERVICE_URL env var
  // 4. BASE_SVC_URL env var (legacy)
  // 5. Default to shell on port 3000
  const authServiceUrl = config.authServiceUrl
    || config.baseSvcUrl
    || process.env.SHELL_URL
    || process.env.AUTH_SERVICE_URL
    || process.env.BASE_SVC_URL
    || 'http://localhost:3000';

  console.log(`[auth] Token validation endpoint: ${authServiceUrl}/api/v1/auth/me`);

  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    // Skip auth for public paths
    const isPublic = publicPaths.some(path =>
      req.path === path || req.path.startsWith(path + '/')
    );
    if (isPublic) {
      return next();
    }

    // Extract token from Authorization header
    const authHeader = req.headers.authorization;

    // Also check x-user-id header (for service-to-service or proxied calls)
    const headerUserId = req.headers['x-user-id'] as string | undefined;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // Allow x-user-id as fallback for internal service calls
      if (headerUserId) {
        req.user = { id: headerUserId };
        return next();
      }
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'Missing or invalid authorization token' },
      });
    }

    const token = authHeader.slice(7);

    // 1. Check cache first
    const cached = getCachedSession(token);
    if (cached) {
      req.user = cached;
      const teamId = req.headers['x-team-id'] as string | undefined;
      if (teamId) req.teamId = teamId;
      return next();
    }

    // 2. Try JWT decode (if token has 3 dot-separated parts)
    const parts = token.split('.');
    if (parts.length === 3) {
      try {
        const payload = JSON.parse(
          Buffer.from(parts[1], 'base64url').toString('utf-8')
        );

        // Check expiry
        if (payload.exp && payload.exp * 1000 < Date.now()) {
          return res.status(401).json({
            success: false,
            error: { code: 'TOKEN_EXPIRED', message: 'Token has expired' },
          });
        }

        req.user = {
          id: payload.sub || payload.id || payload.userId,
          email: payload.email,
          role: payload.role,
          roles: payload.roles,
        };

        setCachedSession(token, req.user);
        const teamId = req.headers['x-team-id'] as string | undefined;
        if (teamId) req.teamId = teamId;
        return next();
      } catch {
        // Not a valid JWT -- fall through to auth service validation
      }
    }

    // 3. Validate opaque token against auth service
    try {
      const validationUrl = `${authServiceUrl}/api/v1/auth/me`;
      console.log(`[auth] Validating token (${token.slice(0, 8)}...${token.slice(-4)}) against ${validationUrl}`);

      const response = await fetch(validationUrl, {
        headers: { 'Authorization': `Bearer ${token}` },
      });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => 'no body');
        console.log(`[auth] Auth service rejected token: HTTP ${response.status} - ${errorBody}`);
        return res.status(401).json({
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'Invalid authorization token' },
        });
      }

      const data = await response.json() as Record<string, unknown>;
      const userData = extractUserFromResponse(data);

      if (!userData) {
        console.log(`[auth] Auth service returned no user data:`, JSON.stringify(data).slice(0, 200));
        return res.status(401).json({
          success: false,
          error: { code: 'INVALID_TOKEN', message: 'Token validation returned no user' },
        });
      }

      req.user = {
        id: userData.id,
        email: userData.email,
        role: userData.roles?.[0],
        roles: userData.roles,
      };

      setCachedSession(token, req.user);

      const teamId = req.headers['x-team-id'] as string | undefined;
      if (teamId) req.teamId = teamId;

      next();
    } catch (err) {
      // Auth service unreachable -- fail open in dev, fail closed in prod
      const isDev = process.env.NODE_ENV !== 'production';
      console.error(`[auth] Failed to reach auth service at ${authServiceUrl} (isDev=${isDev}):`, err);
      if (isDev && headerUserId) {
        req.user = { id: headerUserId };
        return next();
      }
      return res.status(401).json({
        success: false,
        error: { code: 'AUTH_SERVICE_ERROR', message: 'Unable to validate authorization token' },
      });
    }
  };
}
