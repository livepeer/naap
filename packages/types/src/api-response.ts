/**
 * Shared API Response Types and Error Codes
 *
 * Single source of truth for API response format.
 * Used by both Next.js API routes and Express services.
 *
 * Response Format:
 * {
 *   success: boolean;
 *   data?: T;
 *   error?: { code: string; message: string; details?: unknown };
 *   meta?: { page?: number; total?: number; timestamp: string };
 * }
 */

export interface APIError {
  code: string;
  message: string;
  details?: unknown;
}

export interface APIMeta {
  page?: number;
  pageSize?: number;
  total?: number;
  totalPages?: number;
  timestamp: string;
}

export interface APIResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: APIError;
  meta?: APIMeta;
}

/**
 * Standard error codes used across all API endpoints.
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

/**
 * Build an API response body (framework-agnostic).
 */
export function buildSuccessResponse<T>(data: T, meta?: Partial<APIMeta>): APIResponse<T> {
  return {
    success: true,
    data,
    meta: meta ? { ...meta, timestamp: new Date().toISOString() } : undefined,
  };
}

export function buildPaginatedResponse<T>(
  data: T[],
  pagination: { page: number; pageSize: number; total: number }
): APIResponse<T[]> {
  const totalPages = Math.ceil(pagination.total / pagination.pageSize);
  return {
    success: true,
    data,
    meta: {
      page: pagination.page,
      pageSize: pagination.pageSize,
      total: pagination.total,
      totalPages,
      timestamp: new Date().toISOString(),
    },
  };
}

export function buildErrorResponse(
  code: ErrorCode | string,
  message: string,
  details?: unknown
): APIResponse<null> {
  return {
    success: false,
    error: { code, message, details },
    meta: { timestamp: new Date().toISOString() },
  };
}

/**
 * Parse pagination from a generic query object or URLSearchParams.
 */
export function parsePaginationParams(query: Record<string, unknown> | URLSearchParams): {
  page: number;
  pageSize: number;
  skip: number;
} {
  let rawPage: string;
  let rawPageSize: string;

  if (query instanceof URLSearchParams) {
    rawPage = query.get('page') || '1';
    rawPageSize = query.get('pageSize') || '20';
  } else {
    rawPage = String(query.page || '1');
    rawPageSize = String(query.pageSize || '20');
  }

  const page = Math.max(1, parseInt(rawPage, 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(rawPageSize, 10)));
  const skip = (page - 1) * pageSize;

  return { page, pageSize, skip };
}
