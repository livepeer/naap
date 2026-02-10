/**
 * Standardized API Response Helpers for Next.js API Routes
 *
 * Wraps shared types from @naap/types with Next.js-specific response helpers.
 */

import { NextResponse } from 'next/server';
import type { APIMeta, APIResponse as SharedAPIResponse, ErrorCode } from '@naap/types';
export {
  type APIError,
  type APIMeta,
  type APIResponse,
  type ErrorCode,
  ErrorCodes,
  buildSuccessResponse,
  buildPaginatedResponse,
  buildErrorResponse,
  parsePaginationParams,
} from '@naap/types';

/**
 * Send a success response
 */
export function success<T>(data: T, meta?: Partial<APIMeta>): NextResponse<SharedAPIResponse<T>> {
  const response: SharedAPIResponse<T> = {
    success: true,
    data,
    meta: meta ? { ...meta, timestamp: new Date().toISOString() } : undefined,
  };

  return NextResponse.json(response);
}

/**
 * Send a paginated success response
 */
export function successPaginated<T>(
  data: T[],
  pagination: { page: number; pageSize: number; total: number }
): NextResponse<SharedAPIResponse<T[]>> {
  const totalPages = Math.ceil(pagination.total / pagination.pageSize);

  const response: SharedAPIResponse<T[]> = {
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

  return NextResponse.json(response);
}

/**
 * Send a success response with no data
 */
export function successNoContent(): NextResponse<SharedAPIResponse<null>> {
  return NextResponse.json({
    success: true,
    meta: { timestamp: new Date().toISOString() },
  });
}

/**
 * Send an error response
 */
export function error(
  code: ErrorCode | string,
  message: string,
  statusCode: number = 400,
  details?: unknown
): NextResponse<SharedAPIResponse<null>> {
  const response: SharedAPIResponse<null> = {
    success: false,
    error: { code, message, details },
    meta: { timestamp: new Date().toISOString() },
  };

  return NextResponse.json(response, { status: statusCode });
}

/**
 * Convenience methods for common errors
 */
export const errors = {
  badRequest: (message: string, details?: unknown) =>
    error('BAD_REQUEST', message, 400, details),

  unauthorized: (message: string = 'Unauthorized') =>
    error('UNAUTHORIZED', message, 401),

  forbidden: (message: string = 'Forbidden') =>
    error('FORBIDDEN', message, 403),

  notFound: (resource: string = 'Resource') =>
    error('NOT_FOUND', `${resource} not found`, 404),

  conflict: (message: string) =>
    error('CONFLICT', message, 409),

  rateLimited: (retryAfter: number) =>
    error('RATE_LIMITED', 'Too many requests', 429, { retryAfter }),

  accountLocked: (lockedUntil: Date) =>
    error('ACCOUNT_LOCKED', 'Account is temporarily locked', 423, {
      lockedUntil: lockedUntil.toISOString()
    }),

  internal: (message: string = 'Internal server error') =>
    error('INTERNAL_ERROR', message, 500),

  serviceUnavailable: (message: string = 'Service temporarily unavailable') =>
    error('SERVICE_UNAVAILABLE', message, 503),

  validationError: (fieldErrors: Record<string, string>) =>
    error('VALIDATION_ERROR', 'Validation failed', 400, { fields: fieldErrors }),
};

/**
 * Check if an error is a Prisma/database connection failure.
 * Used to return 503 instead of misleading 401/400 when the DB is unreachable.
 */
export function isDatabaseError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const name = (err as { name?: string }).name || '';
  const message = (err as { message?: string }).message || '';
  if (
    name === 'PrismaClientInitializationError' ||
    name === 'PrismaClientRustPanicError' ||
    /Can't reach database|Connection refused|ECONNREFUSED|timed?\s*out|datasource.*url/i.test(message)
  ) {
    return true;
  }
  const code = (err as { code?: string }).code;
  if (code && ['P1001', 'P1002', 'P1003', 'P1008', 'P1017'].includes(code)) {
    return true;
  }
  return false;
}

/**
 * Parse pagination query params from URLSearchParams
 */
export function parsePagination(searchParams: URLSearchParams): {
  page: number;
  pageSize: number;
  skip: number;
} {
  const page = Math.max(1, parseInt(searchParams.get('page') || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(searchParams.get('pageSize') || '20', 10)));
  const skip = (page - 1) * pageSize;

  return { page, pageSize, skip };
}

/**
 * Get client IP from request headers
 */
export function getClientIP(request: Request): string | undefined {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }
  return request.headers.get('x-real-ip') || undefined;
}

/**
 * Get auth token from request
 */
export function getAuthToken(request: Request): string | null {
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }

  // Also check cookies
  const cookies = request.headers.get('cookie');
  if (cookies) {
    const tokenMatch = cookies.match(/naap_auth_token=([^;]+)/);
    if (tokenMatch) {
      return tokenMatch[1];
    }
  }

  return null;
}
