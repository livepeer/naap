/**
 * Plugin Testing Service
 * 
 * Provides comprehensive testing for plugin builds:
 * - UMD bundle validation
 * - Backend health check validation
 * - Performance benchmarking
 */

import * as ipaddr from 'ipaddr.js';
import { lookup } from 'node:dns/promises';

/** IP ranges considered non-routable / internal for SSRF protection. */
const BLOCKED_RANGES: readonly string[] = [
  'unspecified',
  'loopback',
  'private',
  'linkLocal',
  'uniqueLocal',
  'carrierGradeNat',
  'reserved',
] as const;

/**
 * Check whether a single IP address falls within a blocked range.
 */
function isBlockedIp(address: string): boolean {
  try {
    const addr = ipaddr.process(address);
    return BLOCKED_RANGES.includes(addr.range());
  } catch {
    return false;
  }
}

/**
 * Validate that a URL is safe for server-side requests (SSRF protection).
 *
 * Uses ipaddr.js for robust IP classification that covers IPv4-mapped IPv6,
 * loopback, link-local (169.254 / fe80), private, ULA, and more.
 *
 * When the hostname is a domain name (not a literal IP), performs DNS
 * resolution and checks every returned address against BLOCKED_RANGES
 * to prevent DNS-rebinding attacks.
 */
async function validateExternalUrl(url: string): Promise<{ valid: boolean; error?: string }> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  if (parsed.protocol !== 'https:') {
    return { valid: false, error: `Unsupported protocol: ${parsed.protocol}` };
  }

  // Normalize hostname: strip trailing dots, lowercase, remove IPv6 brackets
  const hostname = parsed.hostname.replace(/\.$/, '').toLowerCase().replace(/^\[|\]$/g, '');

  // Check DNS-style names that resolve to internal services
  if (
    hostname === 'localhost' ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.local')
  ) {
    return { valid: false, error: 'Requests to private/internal networks are not allowed' };
  }

  // Check IP addresses using ipaddr.js (handles IPv4, IPv6, and IPv4-mapped IPv6)
  if (ipaddr.isValid(hostname)) {
    if (isBlockedIp(hostname)) {
      return { valid: false, error: 'Requests to private/internal networks are not allowed' };
    }
  } else {
    // Hostname is a domain name — resolve DNS and check all returned IPs
    try {
      const records = await lookup(hostname, { all: true });
      for (const { address } of records) {
        if (isBlockedIp(address)) {
          return { valid: false, error: 'Requests to private/internal networks are not allowed' };
        }
      }
    } catch {
      return { valid: false, error: 'DNS resolution failed' };
    }
  }

  return { valid: true };
}

/**
 * Perform a fetch with redirect safety.
 * Uses `redirect: 'manual'` so we can validate each redirect Location
 * through validateExternalUrl before following it.
 */
async function safeFetch(
  url: string,
  init: RequestInit,
  maxRedirects: number = 5,
): Promise<Response> {
  let current = url;
  for (let i = 0; i <= maxRedirects; i++) {
    // Validate each request target before making any outbound call.
    const check = await validateExternalUrl(current);
    if (!check.valid) {
      throw new Error(check.error || 'Request target is not allowed');
    }

    const currentUrl = new URL(current);
    if (currentUrl.protocol !== 'https:') {
      throw new Error('Only HTTPS URLs are allowed');
    }

    const res = await fetch(currentUrl.toString(), { ...init, redirect: 'manual' });

    // Not a redirect — return as-is
    if (res.status < 300 || res.status >= 400) {
      return res;
    }

    // 3xx redirect — validate the Location header before following
    const location = res.headers.get('location');
    if (!location) {
      throw new Error('Redirect with no Location header');
    }

    const target = new URL(location, current).toString();
    const targetUrl = new URL(target);
    if (targetUrl.protocol !== 'https:') {
      throw new Error('Redirect target must use HTTPS');
    }

    current = target;
  }
  throw new Error(`Too many redirects (>${maxRedirects})`);
}

export interface FrontendTestResult {
  success: boolean;
  loadTime: number;
  size: number;
  bundleValid: boolean;
  globalName: string | null;
  errors: string[];
  warnings: string[];
}

export interface BackendTestResult {
  success: boolean;
  healthy: boolean;
  responseTime: number;
  status: string;
  version?: string;
  endpoints?: string[];
  errors: string[];
}

export interface PluginTestResult {
  success: boolean;
  frontend?: FrontendTestResult;
  backend?: BackendTestResult;
  overallErrors: string[];
}

/**
 * Test frontend UMD bundle loading
 */
export async function testFrontendLoading(
  bundleUrl: string,
  timeout: number = 10000
): Promise<FrontendTestResult> {
  const errors: string[] = [];
  const warnings: string[] = [];
  const startTime = Date.now();

  try {
    const urlCheck = await validateExternalUrl(bundleUrl);
    if (!urlCheck.valid) {
      return {
        success: false,
        loadTime: 0,
        size: 0,
        bundleValid: false,
        globalName: null,
        errors: [urlCheck.error || 'Invalid URL'],
        warnings: [],
      };
    }

    // Fetch the UMD bundle with timeout
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await safeFetch(bundleUrl, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        success: false,
        loadTime: Date.now() - startTime,
        size: 0,
        bundleValid: false,
        globalName: null,
        errors: [`HTTP error: ${response.status} ${response.statusText}`],
        warnings: [],
      };
    }

    const content = await response.text();
    const loadTime = Date.now() - startTime;

    // Validate UMD bundle structure
    const validation = validateUMDBundleContent(content);

    if (!validation.valid) {
      errors.push(...validation.errors);
    }
    warnings.push(...validation.warnings);

    return {
      success: validation.valid,
      loadTime,
      size: content.length,
      bundleValid: validation.valid,
      globalName: validation.globalName,
      errors,
      warnings,
    };
  } catch (error) {
    const loadTime = Date.now() - startTime;

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        errors.push(`Request timed out after ${timeout}ms`);
      } else {
        errors.push(error.message);
      }
    } else {
      errors.push('Unknown error occurred');
    }

    return {
      success: false,
      loadTime,
      size: 0,
      bundleValid: false,
      globalName: null,
      errors,
      warnings: [],
    };
  }
}

/**
 * Validate UMD bundle content
 */
function validateUMDBundleContent(content: string): {
  valid: boolean;
  globalName: string | null;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  let globalName: string | null = null;

  // Check for empty content
  if (!content || content.trim().length === 0) {
    errors.push('Bundle file is empty');
    return { valid: false, globalName, errors, warnings };
  }

  // Check for UMD wrapper patterns
  const hasUMDWrapper =
    content.includes('typeof exports') ||
    content.includes('typeof define') ||
    content.includes('factory(global') ||
    content.includes('.mount') ||
    content.includes('NaapPlugin');

  if (!hasUMDWrapper) {
    errors.push('File does not appear to be a valid UMD bundle');
    return { valid: false, globalName, errors, warnings };
  }

  // Extract global name (NaapPlugin*)
  const globalNameMatch = content.match(/(?:global|window)\["?(NaapPlugin[A-Za-z]+)"?\]/);
  if (globalNameMatch) {
    globalName = globalNameMatch[1];
  }

  // Check for mount function (required for UMD plugins)
  const hasMount = content.includes('.mount') || content.includes('mount:');
  if (!hasMount) {
    warnings.push('Bundle may not export a mount function - plugin may fail to render');
  }

  // Warn if React is bundled (should be externalized)
  if (content.includes('react-dom') && content.includes('createElement') && content.length > 200 * 1024) {
    warnings.push('React appears to be bundled - should be externalized for smaller bundle size');
  }

  // Size warning
  if (content.length > 500 * 1024) {
    warnings.push(`Bundle is large (${(content.length / 1024).toFixed(1)}KB) - may impact load time`);
  }

  return {
    valid: errors.length === 0,
    globalName,
    errors,
    warnings,
  };
}

/**
 * Test backend health
 */
export async function testBackendHealth(
  backendUrl: string,
  timeout: number = 5000
): Promise<BackendTestResult> {
  const errors: string[] = [];
  const startTime = Date.now();

  const urlCheck = await validateExternalUrl(backendUrl);
  if (!urlCheck.valid) {
    return {
      success: false,
      healthy: false,
      responseTime: 0,
      status: 'error',
      errors: [urlCheck.error || 'Invalid URL'],
    };
  }

  // Normalize URL to health endpoint
  let healthUrl = backendUrl;
  if (!healthUrl.endsWith('/healthz') && !healthUrl.includes('/health')) {
    healthUrl = healthUrl.replace(/\/$/, '') + '/healthz';
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await safeFetch(healthUrl, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const responseTime = Date.now() - startTime;

    if (!response.ok) {
      return {
        success: false,
        healthy: false,
        responseTime,
        status: `HTTP ${response.status}`,
        errors: [`Health check failed: ${response.status} ${response.statusText}`],
      };
    }

    // Try to parse JSON response
    let data: { status?: string; version?: string; endpoints?: string[] } = {};
    try {
      data = await response.json();
    } catch {
      // Non-JSON response is OK if status was 200
    }

    // Determine if healthy - only true if status explicitly says ok/healthy, 
    // or if no status but response was OK
    const healthy = 
      data.status === 'ok' || 
      data.status === 'healthy' || 
      (!data.status && response.ok);

    return {
      success: true,
      healthy,
      responseTime,
      status: data.status || 'ok',
      version: data.version,
      endpoints: data.endpoints,
      errors: [],
    };
  } catch (error) {
    const responseTime = Date.now() - startTime;

    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        errors.push(`Health check timed out after ${timeout}ms`);
      } else if (error.message.includes('ECONNREFUSED')) {
        errors.push('Backend not running (connection refused)');
      } else {
        errors.push(error.message);
      }
    } else {
      errors.push('Unknown error during health check');
    }

    return {
      success: false,
      healthy: false,
      responseTime,
      status: 'error',
      errors,
    };
  }
}

/**
 * Test complete plugin (frontend + backend)
 */
export async function testPlugin(options: {
  frontendUrl?: string;
  backendUrl?: string;
  frontendTimeout?: number;
  backendTimeout?: number;
}): Promise<PluginTestResult> {
  const {
    frontendUrl,
    backendUrl,
    frontendTimeout = 10000,
    backendTimeout = 5000,
  } = options;

  const overallErrors: string[] = [];
  let frontendResult: FrontendTestResult | undefined;
  let backendResult: BackendTestResult | undefined;

  // Test frontend if URL provided
  if (frontendUrl) {
    frontendResult = await testFrontendLoading(frontendUrl, frontendTimeout);
    if (!frontendResult.success) {
      overallErrors.push(...frontendResult.errors.map(e => `Frontend: ${e}`));
    }
  }

  // Test backend if URL provided
  if (backendUrl) {
    backendResult = await testBackendHealth(backendUrl, backendTimeout);
    if (!backendResult.success || !backendResult.healthy) {
      overallErrors.push(...backendResult.errors.map(e => `Backend: ${e}`));
    }
  }

  // Determine overall success
  const success =
    (!frontendUrl || (frontendResult?.success ?? false)) &&
    (!backendUrl || (backendResult?.healthy ?? false));

  return {
    success,
    frontend: frontendResult,
    backend: backendResult,
    overallErrors,
  };
}
