/**
 * Standardized API Response Helpers for Express
 *
 * Wraps shared types from @naap/types with Express-specific response helpers.
 */

import { Response } from 'express';
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
export function success<T>(res: Response, data: T, meta?: Partial<APIMeta>): void {
  const response: SharedAPIResponse<T> = {
    success: true,
    data,
    meta: meta ? { ...meta, timestamp: new Date().toISOString() } : undefined,
  };

  res.json(response);
}

/**
 * Send a paginated success response
 */
export function successPaginated<T>(
  res: Response,
  data: T[],
  pagination: { page: number; pageSize: number; total: number }
): void {
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

  res.json(response);
}

/**
 * Send a success response with no data
 */
export function successNoContent(res: Response): void {
  res.json({
    success: true,
    meta: { timestamp: new Date().toISOString() },
  });
}

/**
 * Send an error response
 */
export function error(
  res: Response,
  code: ErrorCode | string,
  message: string,
  statusCode: number = 400,
  details?: unknown
): void {
  const response: SharedAPIResponse = {
    success: false,
    error: { code, message, details },
    meta: { timestamp: new Date().toISOString() },
  };

  res.status(statusCode).json(response);
}

/**
 * Convenience methods for common errors
 */
export const errors = {
  badRequest: (res: Response, message: string, details?: unknown) =>
    error(res, 'BAD_REQUEST', message, 400, details),

  unauthorized: (res: Response, message: string = 'Unauthorized') =>
    error(res, 'UNAUTHORIZED', message, 401),

  forbidden: (res: Response, message: string = 'Forbidden') =>
    error(res, 'FORBIDDEN', message, 403),

  notFound: (res: Response, resource: string = 'Resource') =>
    error(res, 'NOT_FOUND', `${resource} not found`, 404),

  conflict: (res: Response, message: string) =>
    error(res, 'CONFLICT', message, 409),

  rateLimited: (res: Response, retryAfter: number) =>
    error(res, 'RATE_LIMITED', 'Too many requests', 429, { retryAfter }),

  accountLocked: (res: Response, lockedUntil: Date) =>
    error(res, 'ACCOUNT_LOCKED', 'Account is temporarily locked', 423, {
      lockedUntil: lockedUntil.toISOString()
    }),

  internal: (res: Response, message: string = 'Internal server error') =>
    error(res, 'INTERNAL_ERROR', message, 500),

  validationError: (res: Response, fieldErrors: Record<string, string>) =>
    error(res, 'VALIDATION_ERROR', 'Validation failed', 400, { fields: fieldErrors }),
};

/**
 * Wrap an async handler to catch errors
 */
export function asyncHandler(
  handler: (req: any, res: Response, next?: any) => Promise<void>
) {
  return async (req: any, res: Response, next: any) => {
    try {
      await handler(req, res, next);
    } catch (err) {
      console.error('Unhandled error:', err);

      if (!res.headersSent) {
        const message = err instanceof Error ? err.message : 'Internal server error';
        errors.internal(res, message);
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
  const pageSize = Math.min(100, Math.max(1, parseInt(String(query.pageSize || '20'), 10)));
  const skip = (page - 1) * pageSize;

  return { page, pageSize, skip };
}
