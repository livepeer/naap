/**
 * Plugin Backend Test API Route
 * POST /api/v1/plugin-publisher/test-backend - Test backend health endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';
import * as ipaddr from 'ipaddr.js';

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
 * Validate that a URL is safe for server-side requests (SSRF protection).
 * Uses ipaddr.js for robust IP classification that covers IPv4-mapped IPv6,
 * loopback, link-local (169.254 / fe80), private, ULA, and more.
 */
function validateExternalUrl(url: string): { valid: boolean; error?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { valid: false, error: 'Invalid URL format' };
  }

  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
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
    try {
      // process() converts IPv4-mapped IPv6 (::ffff:127.0.0.1) to plain IPv4
      const addr = ipaddr.process(hostname);
      const range = addr.range();
      if (BLOCKED_RANGES.includes(range)) {
        return { valid: false, error: 'Requests to private/internal networks are not allowed' };
      }
    } catch {
      return { valid: false, error: 'Invalid IP address' };
    }
  }

  return { valid: true };
}

async function testBackendHealth(
  backendUrl: string,
  timeout: number = 5000,
): Promise<{
  success: boolean;
  responseTimeMs?: number;
  healthStatus?: string;
  errors: string[];
}> {
  const testErrors: string[] = [];
  const startTime = Date.now();

  try {
    const urlCheck = validateExternalUrl(backendUrl);
    if (!urlCheck.valid) {
      return { success: false, errors: [urlCheck.error || 'Invalid URL'] };
    }

    const healthUrl = backendUrl.endsWith('/healthz')
      ? backendUrl
      : `${backendUrl.replace(/\/$/, '')}/healthz`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(healthUrl, {
      method: 'GET',
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    const responseTimeMs = Date.now() - startTime;

    if (!response.ok) {
      testErrors.push(`Backend health check returned ${response.status}: ${response.statusText}`);
      return { success: false, responseTimeMs, errors: testErrors };
    }

    let healthStatus = 'ok';
    try {
      const data = await response.json();
      healthStatus = data.status || 'ok';
    } catch {
      // Response might not be JSON
    }

    return {
      success: testErrors.length === 0,
      responseTimeMs,
      healthStatus,
      errors: testErrors,
    };
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === 'AbortError') {
        testErrors.push(`Backend request timed out after ${timeout}ms`);
      } else {
        testErrors.push(`Backend request failed: ${err.message}`);
      }
    }
    return { success: false, errors: testErrors };
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const csrfError = validateCSRF(request, token);
    if (csrfError) {
      return csrfError;
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    const body = await request.json();
    const { backendUrl } = body;

    if (!backendUrl) {
      return errors.badRequest('backendUrl is required');
    }

    const result = await testBackendHealth(backendUrl);
    return success(result);
  } catch (err) {
    console.error('Backend test error:', err);
    return success({
      success: false,
      errors: [err instanceof Error ? err.message : 'Test failed'],
    });
  }
}
