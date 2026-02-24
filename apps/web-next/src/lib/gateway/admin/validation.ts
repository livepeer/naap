/**
 * Service Gateway — Admin API Validation Schemas
 *
 * Zod schemas for all connector and endpoint create/update operations.
 */

import { z } from 'zod';

// ── Connector Schemas ──

export const authTypeEnum = z.enum(['none', 'bearer', 'header', 'basic', 'query']);

export const visibilityEnum = z.enum(['private', 'team', 'public']);

export const createConnectorSchema = z.object({
  slug: z
    .string()
    .min(2)
    .max(64)
    .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/, 'Slug must be lowercase alphanumeric with hyphens'),
  displayName: z.string().min(1).max(128),
  description: z.string().max(1024).optional(),
  visibility: visibilityEnum.default('private'),
  upstreamBaseUrl: z.string().url('Invalid upstream URL'),
  allowedHosts: z.array(z.string()).default([]),
  defaultTimeout: z.number().int().min(1000).max(120_000).default(30_000),
  healthCheckPath: z.string().max(256).optional(),
  authType: authTypeEnum.default('none'),
  authConfig: z.record(z.unknown()).default({}),
  secretRefs: z.array(z.string().max(64)).default([]),
  responseWrapper: z.boolean().default(true),
  streamingEnabled: z.boolean().default(false),
  errorMapping: z.record(z.string()).default({}),
  tags: z.array(z.string().max(32)).default([]),
});

export const updateConnectorSchema = createConnectorSchema.partial().omit({ slug: true });

// ── Endpoint Schemas ──

export const httpMethodEnum = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE']);

export const createEndpointSchema = z.object({
  name: z.string().min(1).max(64),
  description: z.string().max(512).optional(),
  method: httpMethodEnum,
  path: z
    .string()
    .min(1)
    .max(256)
    .regex(/^\//, 'Path must start with /'),
  enabled: z.boolean().default(true),
  upstreamMethod: httpMethodEnum.optional(),
  upstreamPath: z.string().min(1).max(256),
  upstreamContentType: z.string().max(128).default('application/json'),
  upstreamQueryParams: z.record(z.string()).default({}),
  upstreamStaticBody: z.string().max(65_536).optional(),
  bodyTransform: z.string().max(128).default('passthrough'),
  headerMapping: z.record(z.string()).default({}),
  rateLimit: z.number().int().min(1).optional(),
  timeout: z.number().int().min(1000).max(120_000).optional(),
  maxRequestSize: z.number().int().min(0).optional(),
  maxResponseSize: z.number().int().min(0).optional(),
  cacheTtl: z.number().int().min(0).optional(),
  retries: z.number().int().min(0).max(5).default(0),
  bodyPattern: z.string().max(1024).optional(),
  bodyBlacklist: z.array(z.string().max(128)).default([]),
  bodySchema: z.unknown().optional(),
  requiredHeaders: z.array(z.string().max(128)).default([]),
});

export const updateEndpointSchema = createEndpointSchema.partial();

// ── Secret Schemas ──

export const storeSecretSchema = z.object({
  name: z.string().min(1).max(64).regex(/^\w+$/, 'Secret name must be alphanumeric/underscore'),
  value: z.string().min(1).max(8192),
});

// ── Type exports ──

export type CreateConnectorInput = z.infer<typeof createConnectorSchema>;
export type UpdateConnectorInput = z.infer<typeof updateConnectorSchema>;
export type CreateEndpointInput = z.infer<typeof createEndpointSchema>;
export type UpdateEndpointInput = z.infer<typeof updateEndpointSchema>;
