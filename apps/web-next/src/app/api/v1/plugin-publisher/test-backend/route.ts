/**
 * Plugin Backend Test API Route
 * POST /api/v1/plugin-publisher/test-backend - Test backend health endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';
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
    const urlCheck = await validateExternalUrl(backendUrl);
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
      redirect: 'error',
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
