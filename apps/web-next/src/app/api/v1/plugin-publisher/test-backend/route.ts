/**
 * Plugin Backend Test API Route
 * POST /api/v1/plugin-publisher/test-backend - Test backend health endpoint
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

/**
 * Validate that a URL is safe for server-side requests (SSRF protection).
 * Blocks requests to private/internal networks and non-http(s) protocols.
 * Covers: loopback (127.0.0.0/8), link-local (169.254.0.0/16, fe80::/10),
 * private (10/8, 172.16/12, 192.168/16), ULA (fc00::/7), and special names.
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

  // Normalize: strip trailing dots and lowercase
  const hostname = parsed.hostname.replace(/\.$/, '').toLowerCase();
  const isIpv6Literal = hostname.includes(':');
  if (
    hostname === 'localhost' ||
    hostname.startsWith('127.') ||
    hostname === '::1' ||
    hostname === '0.0.0.0' ||
    hostname.startsWith('0.') ||
    hostname.startsWith('169.254.') ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    (isIpv6Literal &&
      (hostname.startsWith('fe80:') || hostname.startsWith('fc') || hostname.startsWith('fd'))) ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.localhost')
  ) {
    return { valid: false, error: 'Requests to private/internal networks are not allowed' };
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
