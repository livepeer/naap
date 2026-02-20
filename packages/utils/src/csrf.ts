/**
 * CSRF Protection Middleware
 * 
 * Shared CSRF protection for all NAAP backend services.
 * This module provides Express middleware for CSRF validation.
 * 
 * Phase 0: Added as part of security foundation
 * 
 * Usage in Express:
 * ```typescript
 * import { createCsrfMiddleware, generateCsrfToken, validateCsrfToken } from '@naap/utils';
 * 
 * // Apply middleware globally
 * app.use('/api', createCsrfMiddleware());
 * 
 * // Or with custom options
 * app.use('/api', createCsrfMiddleware({
 *   skipPaths: ['/health', '/metrics'],
 *   headerName: 'X-CSRF-Token',
 *   logOnly: true, // Log violations but don't reject (for gradual rollout)
 * }));
 * ```
 */

import * as crypto from 'crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';

// CSRF token store: sessionToken -> { token, createdAt }
// In production, this should use Redis for distributed deployments
const csrfTokenStore = new Map<string, { token: string; createdAt: number }>();

// Token TTL: 24 hours (same as session)
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

// Clean up expired tokens every 10 minutes
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function startCleanup() {
  if (cleanupInterval) return;
  
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [key, value] of csrfTokenStore.entries()) {
      if (now - value.createdAt > TOKEN_TTL_MS) {
        csrfTokenStore.delete(key);
      }
    }
  }, 10 * 60 * 1000);
}

// Start cleanup on module load
startCleanup();

/**
 * Generate a CSRF token for a session
 * @param sessionToken The session/auth token to bind the CSRF token to
 * @returns The CSRF token
 */
export function generateCsrfToken(sessionToken: string): string {
  // Check if we already have a valid token for this session
  const existing = csrfTokenStore.get(sessionToken);
  if (existing && Date.now() - existing.createdAt < TOKEN_TTL_MS) {
    return existing.token;
  }

  // Generate new token
  const csrfToken = crypto.randomBytes(32).toString('hex');
  csrfTokenStore.set(sessionToken, {
    token: csrfToken,
    createdAt: Date.now(),
  });

  return csrfToken;
}

/**
 * Validate a CSRF token against a session
 * @param sessionToken The session/auth token
 * @param csrfToken The CSRF token to validate
 * @returns Whether the token is valid
 */
export function validateCsrfToken(sessionToken: string, csrfToken: string): boolean {
  if (!sessionToken || !csrfToken) {
    return false;
  }

  const stored = csrfTokenStore.get(sessionToken);
  if (!stored) {
    return false;
  }

  // Check if expired
  if (Date.now() - stored.createdAt > TOKEN_TTL_MS) {
    csrfTokenStore.delete(sessionToken);
    return false;
  }

  // Constant-time comparison to prevent timing attacks
  try {
    return crypto.timingSafeEqual(
      Buffer.from(stored.token, 'hex'),
      Buffer.from(csrfToken, 'hex')
    );
  } catch {
    return false;
  }
}

/**
 * Invalidate CSRF token for a session (on logout)
 * @param sessionToken The session token to invalidate
 */
export function invalidateCsrfToken(sessionToken: string): void {
  csrfTokenStore.delete(sessionToken);
}

/**
 * Options for CSRF middleware
 */
export interface CsrfMiddlewareOptions {
  /** Paths to skip CSRF check (e.g., ['/health', '/metrics']) */
  skipPaths?: string[];
  /** HTTP methods to skip (default: ['GET', 'HEAD', 'OPTIONS']) */
  skipMethods?: string[];
  /** Header name for CSRF token (default: 'x-csrf-token') */
  headerName?: string;
  /** If true, log violations but don't reject requests (for gradual rollout) */
  logOnly?: boolean;
  /** Custom logger function */
  logger?: (message: string, data?: Record<string, unknown>) => void;
}

const DEFAULT_OPTIONS: Required<Omit<CsrfMiddlewareOptions, 'logger'>> & Pick<CsrfMiddlewareOptions, 'logger'> = {
  skipPaths: [],
  skipMethods: ['GET', 'HEAD', 'OPTIONS'],
  headerName: 'x-csrf-token',
  logOnly: false,
  logger: undefined,
};

/**
 * Create Express middleware for CSRF protection
 * 
 * Feature flag: Set `logOnly: true` for gradual rollout
 * This allows monitoring violations without breaking existing functionality
 */
export function createCsrfMiddleware(options: CsrfMiddlewareOptions = {}): RequestHandler {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const log = opts.logger || console.log;

  const csrfMiddleware: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    // Skip safe methods
    if (opts.skipMethods.includes(req.method)) {
      return next();
    }

    // Skip configured paths
    const path = req.path || req.url;
    if (opts.skipPaths.some(skip => path.startsWith(skip) || path.includes(skip))) {
      return next();
    }

    // Skip OAuth callbacks and webhooks (they have their own auth)
    if (path.includes('/callback/') || path.includes('/webhook')) {
      return next();
    }

    // Get session token from Authorization header
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      // No auth header means this is a public endpoint (login/register)
      return next();
    }

    const token = authHeader.substring(7);

    // Skip CSRF for API tokens (they have their own auth mechanism)
    // API tokens start with 'naap_', session tokens are JWTs or other formats
    if (token.startsWith('naap_')) {
      return next();
    }

    // Get CSRF token from header
    const csrfToken = req.headers[opts.headerName] as string | undefined;

    // Validate CSRF token
    if (!validateCsrfToken(token, csrfToken || '')) {
      const logData = {
        path,
        method: req.method,
        hasToken: !!csrfToken,
        ip: req.ip,
      };

      if (opts.logOnly) {
        log('[CSRF] Violation (log-only mode)', logData);
        return next();
      }

      log('[CSRF] Rejected request', logData);
      res.status(403).json({
        success: false,
        error: {
          code: 'CSRF_INVALID',
          message: 'Invalid or missing CSRF token',
        },
      });
      return;
    }

    next();
  };

  return csrfMiddleware;
}

/**
 * Get CSRF token for a request (for including in API responses)
 * Call this after authentication to provide CSRF token to client
 */
export function getCsrfTokenForRequest(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.substring(7);
  
  // Don't generate CSRF for API tokens
  if (token.startsWith('naap_')) {
    return null;
  }

  return generateCsrfToken(token);
}
