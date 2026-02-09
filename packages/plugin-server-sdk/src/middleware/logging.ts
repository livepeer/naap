/**
 * Request Logging Middleware
 *
 * Logs incoming requests with correlation IDs for distributed tracing.
 */

import type { Request, Response, NextFunction } from 'express';

export function createRequestLogger(serviceName: string) {
  return (req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();

    // Extract or generate correlation/request IDs
    const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
    const traceId = (req.headers['x-trace-id'] as string) || crypto.randomUUID();
    const correlationId = (req.headers['x-correlation-id'] as string) || requestId;

    // Set on response headers for tracing
    res.setHeader('x-request-id', requestId);
    res.setHeader('x-trace-id', traceId);

    // Log on response finish
    res.on('finish', () => {
      const duration = Date.now() - start;
      const logEntry = {
        service: serviceName,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration,
        requestId,
        traceId,
        correlationId,
        userAgent: req.headers['user-agent']?.substring(0, 100),
      };

      if (res.statusCode >= 500) {
        console.error(JSON.stringify(logEntry));
      } else if (res.statusCode >= 400) {
        console.warn(JSON.stringify(logEntry));
      } else if (req.path !== '/healthz') {
        console.log(JSON.stringify(logEntry));
      }
    });

    next();
  };
}
