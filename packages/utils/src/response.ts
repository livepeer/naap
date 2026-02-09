/**
 * Standardized API Response Format
 * 
 * Phase 1: Unified response format for all NAAP services
 * 
 * Response Format (v2):
 * {
 *   success: boolean;
 *   data?: T;
 *   error?: { code: string; message: string; details?: unknown };
 *   meta?: { requestId?: string; timestamp: string; page?: number; total?: number };
 * }
 * 
 * Backward Compatibility:
 * - Supports Accept-Version header for version negotiation
 * - Default response format depends on feature flag
 * - SDK auto-detects and handles both formats
 */

import type { Request, Response } from 'express';

// ============================================
// Types
// ============================================

export interface APIError {
  code: string;
  message: string;
  details?: unknown;
}

export interface APIMeta {
  requestId?: string;
  timestamp: string;
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
  /** Indicates this is using deprecated format */
  deprecatedFormat?: boolean;
}

export interface APIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: APIError;
  meta?: APIMeta;
}

/**
 * Standard error codes for consistent error handling
 */
export const ErrorCodes = {
  // Authentication errors (401)
  UNAUTHORIZED: 'UNAUTHORIZED',
  INVALID_TOKEN: 'INVALID_TOKEN',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  
  // Authorization errors (403)
  FORBIDDEN: 'FORBIDDEN',
  INSUFFICIENT_PERMISSIONS: 'INSUFFICIENT_PERMISSIONS',
  CSRF_INVALID: 'CSRF_INVALID',
  
  // Client errors (400)
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  MISSING_REQUIRED_FIELD: 'MISSING_REQUIRED_FIELD',
  INVALID_FORMAT: 'INVALID_FORMAT',
  
  // Resource errors (404, 409, 410)
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  ALREADY_EXISTS: 'ALREADY_EXISTS',
  GONE: 'GONE',
  
  // Rate limiting (429)
  RATE_LIMITED: 'RATE_LIMITED',
  
  // Account state (423)
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_DISABLED: 'ACCOUNT_DISABLED',
  
  // Server errors (500)
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  DATABASE_ERROR: 'DATABASE_ERROR',
} as const;

export type ErrorCode = typeof ErrorCodes[keyof typeof ErrorCodes];

// ============================================
// Version Detection
// ============================================

/**
 * Get the API version requested by the client
 * Default: '1.0' for backward compatibility
 */
export function getApiVersion(req: Request): string {
  // Check Accept-Version header first
  const acceptVersion = req.headers['accept-version'] as string | undefined;
  if (acceptVersion) {
    return acceptVersion;
  }
  
  // Check X-API-Version header (alternative)
  const xApiVersion = req.headers['x-api-version'] as string | undefined;
  if (xApiVersion) {
    return xApiVersion;
  }
  
  // Check query parameter
  const queryVersion = req.query['api-version'] as string | undefined;
  if (queryVersion) {
    return queryVersion;
  }
  
  // Default to v1 for backward compatibility
  return '1.0';
}

/**
 * Check if client wants new response format (v2.0)
 */
export function wantsNewFormat(req: Request): boolean {
  const version = getApiVersion(req);
  return version.startsWith('2');
}

// ============================================
// Response Helpers
// ============================================

/**
 * Create meta object with request context
 */
function createMeta(req: Request, additional?: Partial<APIMeta>): APIMeta {
  return {
    requestId: (req.headers['x-correlation-id'] || req.headers['x-request-id']) as string | undefined,
    timestamp: new Date().toISOString(),
    ...additional,
  };
}

/**
 * Send a success response
 * Supports both v1 (legacy) and v2 (new) formats based on Accept-Version header
 */
export function success<T>(req: Request, res: Response, data: T, meta?: Partial<APIMeta>): void {
  const useNewFormat = wantsNewFormat(req);
  
  if (useNewFormat) {
    // v2 format
    const response: APIResponse<T> = {
      success: true,
      data,
      meta: createMeta(req, meta),
    };
    res.json(response);
  } else {
    // v1 format (backward compatible) - return data directly
    // But add deprecation header
    res.setHeader('X-Deprecated-Format', 'true');
    res.setHeader('X-API-Version', '1.0');
    
    // If meta has pagination info, wrap in object
    if (meta?.total !== undefined) {
      res.json({ data, total: meta.total, page: meta.page, pageSize: meta.pageSize });
    } else {
      res.json(data);
    }
  }
}

/**
 * Send a paginated success response
 */
export function successPaginated<T>(
  req: Request,
  res: Response,
  data: T[],
  pagination: { page: number; pageSize: number; total: number }
): void {
  const totalPages = Math.ceil(pagination.total / pagination.pageSize);
  const useNewFormat = wantsNewFormat(req);
  
  if (useNewFormat) {
    const response: APIResponse<T[]> = {
      success: true,
      data,
      meta: createMeta(req, {
        page: pagination.page,
        pageSize: pagination.pageSize,
        total: pagination.total,
        totalPages,
      }),
    };
    res.json(response);
  } else {
    // v1 format
    res.setHeader('X-Deprecated-Format', 'true');
    res.json({
      data,
      total: pagination.total,
      page: pagination.page,
      pageSize: pagination.pageSize,
      totalPages,
    });
  }
}

/**
 * Send a success response with no data (204-like but 200 for consistency)
 */
export function successNoContent(req: Request, res: Response): void {
  const useNewFormat = wantsNewFormat(req);
  
  if (useNewFormat) {
    res.json({
      success: true,
      meta: createMeta(req),
    });
  } else {
    res.setHeader('X-Deprecated-Format', 'true');
    res.json({ success: true });
  }
}

/**
 * Send an error response
 */
export function error(
  req: Request,
  res: Response,
  code: ErrorCode | string,
  message: string,
  statusCode: number = 400,
  details?: unknown
): void {
  const useNewFormat = wantsNewFormat(req);
  
  if (useNewFormat) {
    const response: APIResponse = {
      success: false,
      error: {
        code,
        message,
        details,
      },
      meta: createMeta(req),
    };
    res.status(statusCode).json(response);
  } else {
    // v1 format - simpler error structure
    res.setHeader('X-Deprecated-Format', 'true');
    res.status(statusCode).json({
      error: message,
      code,
      details,
    });
  }
}

/**
 * Convenience methods for common errors
 */
export const errors = {
  badRequest: (req: Request, res: Response, message: string, details?: unknown) =>
    error(req, res, ErrorCodes.BAD_REQUEST, message, 400, details),
    
  unauthorized: (req: Request, res: Response, message: string = 'Unauthorized') =>
    error(req, res, ErrorCodes.UNAUTHORIZED, message, 401),
    
  forbidden: (req: Request, res: Response, message: string = 'Forbidden') =>
    error(req, res, ErrorCodes.FORBIDDEN, message, 403),
    
  notFound: (req: Request, res: Response, resource: string = 'Resource') =>
    error(req, res, ErrorCodes.NOT_FOUND, `${resource} not found`, 404),
    
  conflict: (req: Request, res: Response, message: string) =>
    error(req, res, ErrorCodes.CONFLICT, message, 409),
    
  rateLimited: (req: Request, res: Response, retryAfter: number) =>
    error(req, res, ErrorCodes.RATE_LIMITED, 'Too many requests', 429, { retryAfter }),
    
  accountLocked: (req: Request, res: Response, lockedUntil: Date) =>
    error(req, res, ErrorCodes.ACCOUNT_LOCKED, 'Account is temporarily locked', 423, { 
      lockedUntil: lockedUntil.toISOString() 
    }),
    
  internal: (req: Request, res: Response, message: string = 'Internal server error') =>
    error(req, res, ErrorCodes.INTERNAL_ERROR, message, 500),
    
  validationError: (req: Request, res: Response, fieldErrors: Record<string, string>) =>
    error(req, res, ErrorCodes.VALIDATION_ERROR, 'Validation failed', 400, { fields: fieldErrors }),
};

/**
 * @deprecated Use asyncHandler from './errorHandler.js' instead
 * This function is kept for backward compatibility but will be removed
 */
export function asyncHandlerLegacy(
  handler: (req: Request, res: Response, next?: unknown) => Promise<void>
) {
  return async (req: Request, res: Response, next: unknown) => {
    try {
      await handler(req, res, next);
    } catch (err) {
      console.error('Unhandled error:', err);
      
      if (!res.headersSent) {
        const message = err instanceof Error ? err.message : 'Internal server error';
        errors.internal(req, res, message);
      }
    }
  };
}

/**
 * Parse pagination query params
 */
export function parsePagination(query: Record<string, unknown>): {
  page: number;
  pageSize: number;
  skip: number;
} {
  const page = Math.max(1, parseInt(String(query.page || '1'), 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(String(query.pageSize || query.limit || '20'), 10)));
  const skip = (page - 1) * pageSize;
  
  return { page, pageSize, skip };
}

// ============================================
// SDK Response Detection
// ============================================

/**
 * Check if a response uses the v2 format
 * Used by SDK to auto-detect response format
 */
export function isV2Response(response: unknown): response is APIResponse {
  if (typeof response !== 'object' || response === null) {
    return false;
  }
  
  const obj = response as Record<string, unknown>;
  return typeof obj.success === 'boolean' && (obj.data !== undefined || obj.error !== undefined);
}

/**
 * Normalize any response to v2 format
 * Used by SDK to handle both old and new responses
 */
export function normalizeResponse<T>(response: unknown): APIResponse<T> {
  if (isV2Response(response)) {
    return response as APIResponse<T>;
  }
  
  // Handle v1 error format
  const obj = response as Record<string, unknown>;
  if (obj.error && typeof obj.error === 'string') {
    return {
      success: false,
      error: {
        code: (obj.code as string) || 'UNKNOWN_ERROR',
        message: obj.error,
        details: obj.details,
      },
    };
  }
  
  // Handle v1 success format (data directly returned)
  return {
    success: true,
    data: response as T,
  };
}
