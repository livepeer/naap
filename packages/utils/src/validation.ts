/**
 * Input Validation Middleware
 * 
 * Phase 1: Zod-based input validation for API endpoints
 * 
 * Features:
 * - Schema-based validation using Zod
 * - Log-only mode for gradual rollout (via feature flag)
 * - Structured validation errors
 * - Request body, query, and params validation
 * 
 * Usage:
 * ```typescript
 * import { z } from 'zod';
 * import { validate, schemas } from '@naap/utils';
 * 
 * app.post('/api/resource', 
 *   validate(schemas.createResource),
 *   (req, res) => { ... }
 * );
 * ```
 */

import type { Request, Response, NextFunction } from 'express';
import { z, ZodError, ZodSchema } from 'zod';

// ============================================
// Types
// ============================================

export interface ValidationOptions {
  /** If true, log validation errors but don't reject requests (gradual rollout) */
  logOnly?: boolean;
  /** Custom logger function */
  logger?: (message: string, details?: unknown) => void;
  /** Strip unknown keys from validated data */
  stripUnknown?: boolean;
}

export interface ValidationLocation {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

export interface ValidationError {
  code: 'VALIDATION_ERROR';
  message: string;
  details: {
    errors: Array<{
      path: string;
      message: string;
      code: string;
    }>;
  };
}

// ============================================
// Default Options
// ============================================

const DEFAULT_OPTIONS: Required<ValidationOptions> = {
  logOnly: false,
  logger: console.warn,
  stripUnknown: true,
};

// ============================================
// Validation Middleware
// ============================================

/**
 * Create validation middleware for request body
 * 
 * @param schema - Zod schema to validate against
 * @param options - Validation options
 * @returns Express middleware
 * 
 * @example
 * ```typescript
 * const createUserSchema = z.object({
 *   email: z.string().email(),
 *   name: z.string().min(1).max(100),
 * });
 * 
 * app.post('/users', validate(createUserSchema), (req, res) => {
 *   // req.body is typed and validated
 * });
 * ```
 */
export function validate<T extends ZodSchema>(
  schema: T,
  options: ValidationOptions = {}
) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  return (req: Request, res: Response, next: NextFunction) => {
    try {
      const result = schema.safeParse(req.body);
      
      if (!result.success) {
        const formatted = formatZodError(result.error);
        
        opts.logger('[Validation Error]', {
          path: req.path,
          method: req.method,
          errors: formatted.details.errors,
        });
        
        if (opts.logOnly) {
          // Log-only mode: attach warnings but continue
          req.validationWarnings = formatted.details.errors;
          return next();
        }
        
        return res.status(400).json({
          success: false,
          error: formatted,
        });
      }
      
      // Replace body with validated/stripped data
      if (opts.stripUnknown) {
        req.body = result.data;
      }
      
      next();
    } catch (error) {
      opts.logger('[Validation Exception]', error);
      
      if (opts.logOnly) {
        return next();
      }
      
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request body',
        },
      });
    }
  };
}

/**
 * Create validation middleware for multiple locations (body, query, params)
 */
export function validateAll(
  schemas: ValidationLocation,
  options: ValidationOptions = {}
) {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  
  return (req: Request, res: Response, next: NextFunction) => {
    const allErrors: Array<{ path: string; message: string; code: string }> = [];
    
    // Validate body
    if (schemas.body) {
      const result = schemas.body.safeParse(req.body);
      if (!result.success) {
        allErrors.push(...formatZodError(result.error, 'body').details.errors);
      } else if (opts.stripUnknown) {
        req.body = result.data;
      }
    }
    
    // Validate query
    if (schemas.query) {
      const result = schemas.query.safeParse(req.query);
      if (!result.success) {
        allErrors.push(...formatZodError(result.error, 'query').details.errors);
      } else if (opts.stripUnknown) {
        req.query = result.data;
      }
    }
    
    // Validate params
    if (schemas.params) {
      const result = schemas.params.safeParse(req.params);
      if (!result.success) {
        allErrors.push(...formatZodError(result.error, 'params').details.errors);
      }
    }
    
    if (allErrors.length > 0) {
      opts.logger('[Validation Error]', {
        path: req.path,
        method: req.method,
        errors: allErrors,
      });
      
      if (opts.logOnly) {
        req.validationWarnings = allErrors;
        return next();
      }
      
      return res.status(400).json({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Validation failed',
          details: { errors: allErrors },
        },
      });
    }
    
    next();
  };
}

// ============================================
// Error Formatting
// ============================================

/**
 * Format Zod error into structured validation error
 */
function formatZodError(error: ZodError, prefix = ''): ValidationError {
  const errors = error.errors.map((err) => ({
    path: prefix ? `${prefix}.${err.path.join('.')}` : err.path.join('.'),
    message: err.message,
    code: err.code,
  }));
  
  return {
    code: 'VALIDATION_ERROR',
    message: 'Validation failed',
    details: { errors },
  };
}

// ============================================
// Common Schemas
// ============================================

/**
 * Common validation schemas for reuse
 */
export const schemas = {
  // ID validation (UUID format)
  uuid: z.string().uuid('Invalid ID format'),
  
  // Pagination query params
  pagination: z.object({
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    offset: z.coerce.number().int().min(0).optional(),
  }),
  
  // Plugin name (kebab-case, 3-50 chars)
  pluginName: z.string()
    .min(3, 'Plugin name must be at least 3 characters')
    .max(50, 'Plugin name must be at most 50 characters')
    .regex(/^[a-z][a-z0-9-]*$/, 'Plugin name must be kebab-case (lowercase, hyphens, start with letter)'),
  
  // Email validation
  email: z.string().email('Invalid email address'),
  
  // Team slug
  teamSlug: z.string()
    .min(3, 'Team slug must be at least 3 characters')
    .max(50, 'Team slug must be at most 50 characters')
    .regex(/^[a-z][a-z0-9-]*$/, 'Team slug must be lowercase with hyphens'),
  
  // Create team request
  createTeam: z.object({
    name: z.string().min(1).max(100),
    slug: z.string()
      .min(3)
      .max(50)
      .regex(/^[a-z][a-z0-9-]*$/),
    description: z.string().max(500).optional(),
  }),
  
  // Plugin publishing request
  publishPlugin: z.object({
    packageName: z.string().min(3).max(50),
    version: z.string().regex(/^\d+\.\d+\.\d+(-[a-z0-9.]+)?$/i, 'Invalid semver version'),
    artifact: z.string().url().optional(),
    artifactPath: z.string().optional(),
  }),
  
  // Permission request
  permission: z.object({
    resource: z.string().min(1).max(100),
    action: z.enum(['create', 'read', 'update', 'delete', 'admin', '*']),
  }),
  
  // Plugin configuration update
  updatePluginConfig: z.object({
    settings: z.record(z.unknown()).optional(),
    enabled: z.boolean().optional(),
    order: z.number().int().optional(),
    pinned: z.boolean().optional(),
  }),
};

// ============================================
// Type Augmentation
// ============================================

// Extend Express Request type to include validation warnings
declare global {
  namespace Express {
    interface Request {
      validationWarnings?: Array<{ path: string; message: string; code: string }>;
    }
  }
}

// Re-export Zod for convenience
export { z, ZodSchema, ZodError } from 'zod';
