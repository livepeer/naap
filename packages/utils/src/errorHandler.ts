/**
 * Centralized Error Handler Middleware
 * 
 * Provides standardized error handling across all Express services.
 * Replaces scattered try/catch patterns with consistent error responses.
 */

import type { Request, Response, NextFunction, ErrorRequestHandler } from 'express';

// ============================================
// Error Types
// ============================================

/**
 * Base application error with status code
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly code: string;
  public readonly isOperational: boolean;

  constructor(
    message: string,
    statusCode: number = 500,
    code: string = 'INTERNAL_ERROR',
    isOperational: boolean = true
  ) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

/**
 * Validation error (400)
 */
export class ValidationError extends AppError {
  public readonly details?: Record<string, string[]>;

  constructor(message: string, details?: Record<string, string[]>) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details;
  }
}

/**
 * Authentication error (401)
 */
export class AuthenticationError extends AppError {
  constructor(message: string = 'Authentication required') {
    super(message, 401, 'AUTHENTICATION_ERROR');
  }
}

/**
 * Authorization error (403)
 */
export class AuthorizationError extends AppError {
  constructor(message: string = 'Insufficient permissions') {
    super(message, 403, 'AUTHORIZATION_ERROR');
  }
}

/**
 * Not found error (404)
 */
export class NotFoundError extends AppError {
  constructor(resource: string = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

/**
 * Conflict error (409)
 */
export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, 409, 'CONFLICT');
  }
}

/**
 * Rate limit error (429)
 */
export class RateLimitError extends AppError {
  constructor(message: string = 'Too many requests') {
    super(message, 429, 'RATE_LIMIT_EXCEEDED');
  }
}

// ============================================
// Structured Logger Interface
// ============================================

export interface StructuredLogger {
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, error?: Error | unknown, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

/**
 * Default console-based structured logger
 */
export const defaultLogger: StructuredLogger = {
  info(message: string, meta?: Record<string, unknown>) {
    console.log(JSON.stringify({ level: 'info', message, ...meta, timestamp: new Date().toISOString() }));
  },
  warn(message: string, meta?: Record<string, unknown>) {
    console.warn(JSON.stringify({ level: 'warn', message, ...meta, timestamp: new Date().toISOString() }));
  },
  error(message: string, error?: Error | unknown, meta?: Record<string, unknown>) {
    const errorInfo = error instanceof Error 
      ? { errorMessage: error.message, stack: error.stack } 
      : { errorMessage: String(error) };
    console.error(JSON.stringify({ 
      level: 'error', 
      message, 
      ...errorInfo, 
      ...meta, 
      timestamp: new Date().toISOString() 
    }));
  },
  debug(message: string, meta?: Record<string, unknown>) {
    if (process.env.NODE_ENV !== 'production') {
      console.debug(JSON.stringify({ level: 'debug', message, ...meta, timestamp: new Date().toISOString() }));
    }
  },
};

// ============================================
// Error Handler Middleware
// ============================================

export interface ErrorHandlerOptions {
  /** Logger to use for errors */
  logger?: StructuredLogger;
  /** Include stack traces in response (should be false in production) */
  includeStack?: boolean;
  /** Custom error transformer */
  transform?: (error: Error) => AppError | null;
  /** Correlation ID header name */
  correlationIdHeader?: string;
}

/**
 * Creates an Express error handler middleware
 */
export function createErrorHandler(options: ErrorHandlerOptions = {}): ErrorRequestHandler {
  const {
    logger = defaultLogger,
    includeStack = process.env.NODE_ENV !== 'production',
    transform,
    correlationIdHeader = 'x-correlation-id',
  } = options;

  return (err: Error, req: Request, res: Response, _next: NextFunction) => {
    // Transform error if custom transformer provided
    let appError: AppError;
    
    if (transform) {
      const transformed = transform(err);
      if (transformed) {
        appError = transformed;
      } else if (err instanceof AppError) {
        appError = err;
      } else {
        appError = new AppError(err.message || 'Internal server error', 500);
      }
    } else if (err instanceof AppError) {
      appError = err;
    } else {
      // Convert unknown errors to AppError
      appError = new AppError(err.message || 'Internal server error', 500);
    }

    // Extract correlation ID
    const correlationId = req.headers[correlationIdHeader] as string || 
      req.headers['x-request-id'] as string || 
      'unknown';

    // Log the error
    logger.error(`Request failed: ${appError.message}`, err, {
      correlationId,
      method: req.method,
      path: req.path,
      statusCode: appError.statusCode,
      code: appError.code,
      userId: (req as any).user?.id,
      tenantId: (req as any).tenant?.tenantId,
      teamId: (req as any).teamContext?.teamId,
    });

    // Build error response
    const errorResponse: Record<string, unknown> = {
      success: false,
      error: {
        message: appError.message,
        code: appError.code,
      },
    };

    // Add validation details if present
    if (appError instanceof ValidationError && appError.details) {
      (errorResponse.error as Record<string, unknown>).details = appError.details;
    }

    // Add stack trace in non-production
    if (includeStack && appError.stack) {
      (errorResponse.error as Record<string, unknown>).stack = appError.stack;
    }

    // Add correlation ID to response
    res.setHeader(correlationIdHeader, correlationId);

    // Send error response
    res.status(appError.statusCode).json(errorResponse);
  };
}

/**
 * Async handler wrapper to catch promise rejections
 */
export function asyncHandler<T extends Request = Request>(
  fn: (req: T, res: Response, next: NextFunction) => Promise<void>
): (req: T, res: Response, next: NextFunction) => void {
  return (req: T, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/**
 * Not found handler for unmatched routes
 */
export function notFoundHandler(req: Request, _res: Response, next: NextFunction): void {
  next(new NotFoundError(`Route ${req.method} ${req.path}`));
}

// ============================================
// Request Context Middleware
// ============================================

declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
      requestStart?: number;
    }
  }
}

/**
 * Adds request context (correlation ID, timing)
 */
export function requestContext(options: { 
  correlationIdHeader?: string 
} = {}): (req: Request, res: Response, next: NextFunction) => void {
  const { correlationIdHeader = 'x-correlation-id' } = options;

  return (req: Request, res: Response, next: NextFunction) => {
    // Generate or use existing correlation ID
    req.correlationId = (req.headers[correlationIdHeader] as string) || 
      `req-${Date.now()}-${Math.random().toString(36).substring(7)}`;
    
    // Set start time for request duration tracking
    req.requestStart = Date.now();

    // Add correlation ID to response headers
    res.setHeader(correlationIdHeader, req.correlationId);

    next();
  };
}

/**
 * Request logging middleware
 */
export function requestLogger(logger: StructuredLogger = defaultLogger) {
  return (req: Request, res: Response, next: NextFunction) => {
    const startTime = Date.now();

    // Log request
    logger.info(`${req.method} ${req.path}`, {
      correlationId: req.correlationId,
      method: req.method,
      path: req.path,
      query: req.query,
      userId: (req as any).user?.id,
    });

    // Log response on finish
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      const level = res.statusCode >= 400 ? 'warn' : 'info';
      
      logger[level](`${req.method} ${req.path} ${res.statusCode}`, {
        correlationId: req.correlationId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration,
        userId: (req as any).user?.id,
      });
    });

    next();
  };
}
