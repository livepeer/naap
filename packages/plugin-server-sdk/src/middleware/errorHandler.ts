/**
 * Error Handler Middleware
 *
 * Standardized error handling for plugin servers.
 * Catches unhandled errors and returns consistent JSON responses.
 */

import type { Request, Response, NextFunction } from 'express';

interface AppError extends Error {
  status?: number;
  code?: string;
}

export function createErrorHandler(serviceName: string) {
  return (err: AppError, req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || 500;
    const code = err.code || 'INTERNAL_ERROR';

    // Log the error
    console.error(JSON.stringify({
      service: serviceName,
      error: err.message,
      code,
      status,
      path: req.path,
      method: req.method,
      stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
      requestId: req.headers['x-request-id'],
    }));

    res.status(status).json({
      success: false,
      error: {
        code,
        message: process.env.NODE_ENV === 'production' && status === 500
          ? 'Internal server error'
          : err.message,
      },
      meta: {
        timestamp: new Date().toISOString(),
        service: serviceName,
        requestId: req.headers['x-request-id'],
      },
    });
  };
}
