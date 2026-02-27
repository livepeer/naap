/**
 * Service Gateway — Transform Strategy Interfaces
 *
 * Narrow context types and strategy contracts for the registry-driven
 * transform pipeline. Each strategy receives only the fields it needs.
 */

import type { ResolvedSecrets } from '../types';

// ── Body Transform ──

export interface BodyTransformContext {
  bodyTransform: string;
  consumerBody: string | null;
  consumerBodyRaw?: ArrayBuffer | null;
  upstreamStaticBody: string | null;
}

export interface BodyTransformStrategy {
  readonly name: string;
  transform(ctx: BodyTransformContext): BodyInit | undefined;
}

// ── Auth Injection ──

export interface AuthContext {
  headers: Headers;
  authConfig: Record<string, unknown>;
  secrets: ResolvedSecrets;
  connectorSlug: string;
  method: string;
  url: URL;
  body?: BodyInit | null;
}

export interface AuthStrategy {
  readonly name: string;
  inject(ctx: AuthContext): void;
}

// ── Response Transform ──

export interface ResponseTransformContext {
  upstreamResponse: Response;
  connectorSlug: string;
  responseWrapper: boolean;
  streamingEnabled: boolean;
  errorMapping: Record<string, string>;
  responseBodyTransform: string;
  upstreamLatencyMs: number;
  cached: boolean;
  requestId: string | null;
  traceId: string | null;
}

export interface ResponseTransformStrategy {
  readonly name: string;
  transform(ctx: ResponseTransformContext): Response | Promise<Response>;
}

// ── Shared Utilities ──

export function interpolateSecrets(template: string, secrets: ResolvedSecrets): string {
  return template.replace(/\{\{secrets\.([\w-]+)\}\}/g, (_, name) => secrets[name] || '');
}

export function interpolateTemplate(template: string, body: Record<string, unknown>): string {
  return template.replace(/\{\{body\.([.\w]+)\}\}/g, (_, path) => {
    const value = getNestedValue(body, path);
    return value !== undefined ? String(value) : '';
  });
}

export function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}
