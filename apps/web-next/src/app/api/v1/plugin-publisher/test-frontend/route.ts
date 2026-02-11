/**
 * Plugin Frontend Test API Route
 * POST /api/v1/plugin-publisher/test-frontend - Test frontend bundle loading
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

async function testFrontendLoading(
  frontendUrl: string,
  timeout: number = 15000,
): Promise<{ success: boolean; loadTimeMs?: number; errors: string[] }> {
  const testErrors: string[] = [];
  const startTime = Date.now();

  try {
    const urlCheck = validateExternalUrl(frontendUrl);
    if (!urlCheck.valid) {
      return { success: false, errors: [urlCheck.error || 'Invalid URL'] };
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(frontendUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: { Accept: '*/*' },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      testErrors.push(`Frontend URL returned ${response.status}: ${response.statusText}`);
      return { success: false, errors: testErrors };
    }

    // Verify content type
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('javascript') && !contentType.includes('text/plain')) {
      testErrors.push(`Expected JavaScript content, got: ${contentType}`);
    }

    // Verify UMD bundle markers
    const content = await response.text();
    if (
      !content.includes('NaapPlugin') &&
      !content.includes('.mount') &&
      !content.includes('typeof exports')
    ) {
      testErrors.push('Content does not appear to be a valid UMD plugin bundle');
    }

    const loadTimeMs = Date.now() - startTime;

    return {
      success: testErrors.length === 0,
      loadTimeMs,
      errors: testErrors,
    };
  } catch (err) {
    if (err instanceof Error) {
      if (err.name === 'AbortError') {
        testErrors.push(`Frontend request timed out after ${timeout}ms`);
      } else {
        testErrors.push(`Frontend request failed: ${err.message}`);
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
    const { frontendUrl } = body;

    if (!frontendUrl) {
      return errors.badRequest('frontendUrl is required');
    }

    const result = await testFrontendLoading(frontendUrl);
    return success(result);
  } catch (err) {
    console.error('Frontend test error:', err);
    return success({
      success: false,
      errors: [err instanceof Error ? err.message : 'Test failed'],
    });
  }
}
