/**
 * Service Gateway — Type Definitions
 *
 * Core types shared across the gateway engine pipeline.
 */

// ── Resolved Config ──

export interface ResolvedConnector {
  id: string;
  teamId: string | null;
  ownerUserId: string | null;
  slug: string;
  displayName: string;
  status: string;
  visibility: string;
  upstreamBaseUrl: string;
  allowedHosts: string[];
  defaultTimeout: number;
  healthCheckPath: string | null;
  authType: string;
  authConfig: Record<string, unknown>;
  secretRefs: string[];
  responseWrapper: boolean;
  streamingEnabled: boolean;
  errorMapping: Record<string, string>;
}

export interface ResolvedEndpoint {
  id: string;
  connectorId: string;
  name: string;
  method: string;
  path: string;
  enabled: boolean;
  upstreamMethod: string | null;
  upstreamPath: string;
  upstreamContentType: string;
  upstreamQueryParams: Record<string, string>;
  upstreamStaticBody: string | null;
  bodyTransform: string;
  headerMapping: Record<string, string>;
  rateLimit: number | null;
  timeout: number | null;
  maxRequestSize: number | null;
  maxResponseSize: number | null;
  cacheTtl: number | null;
  retries: number;
  bodyPattern: string | null;
  bodyBlacklist: string[];
  bodySchema: unknown;
  requiredHeaders: string[];
}

export interface ResolvedConfig {
  connector: ResolvedConnector;
  endpoint: ResolvedEndpoint;
}

// ── Auth ──

export type CallerType = 'jwt' | 'apiKey';

export interface AuthResult {
  authenticated: boolean;
  callerType: CallerType;
  callerId: string;
  teamId: string;
  apiKeyId?: string;
  planId?: string;
  allowedEndpoints?: string[];
  allowedIPs?: string[];
  rateLimit?: number;
  dailyQuota?: number | null;
  monthlyQuota?: number | null;
  maxRequestSize?: number;
}

// ── Team Context ──

export interface TeamContext {
  teamId: string;
  userId?: string;
}

// ── Transform ──

export interface UpstreamRequest {
  url: string;
  method: string;
  headers: Headers;
  body: BodyInit | undefined;
}

// ── Proxy ──

export interface ProxyResult {
  response: Response;
  upstreamLatencyMs: number;
  cached: boolean;
}

// ── Usage ──

export interface UsageData {
  teamId: string;
  ownerScope: string;
  connectorId: string;
  endpointName: string;
  apiKeyId: string | null;
  callerType: CallerType;
  callerId: string;
  method: string;
  path: string;
  statusCode: number;
  latencyMs: number;
  upstreamLatencyMs: number;
  requestBytes: number;
  responseBytes: number;
  cached: boolean;
  error: string | null;
  region: string | null;
}

// ── Secrets ──

export interface ResolvedSecrets {
  [key: string]: string;
}

// ── SSRF ──

const PRIVATE_IP_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^0\./,
  /^169\.254\./,
  /^fc00:/,
  /^fe80:/,
  /^::1$/,
  /^localhost$/i,
];

export function isPrivateHost(hostname: string): boolean {
  return PRIVATE_IP_RANGES.some((pattern) => pattern.test(hostname));
}

export function validateHost(hostname: string, allowedHosts: string[]): boolean {
  if (isPrivateHost(hostname)) return false;
  if (allowedHosts.length === 0) return true;
  return allowedHosts.some((allowed) => {
    if (allowed.startsWith('*.')) {
      return hostname.endsWith(allowed.slice(1)) || hostname === allowed.slice(2);
    }
    return hostname === allowed;
  });
}
