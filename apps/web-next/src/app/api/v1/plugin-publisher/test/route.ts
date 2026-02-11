/**
 * Plugin Testing Endpoint
 * POST /api/v1/plugin-publisher/test - Test plugin loading
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

/**
 * Validate that a URL is safe for server-side requests (SSRF protection).
 * Blocks requests to private/internal networks and non-http(s) protocols.
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

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '::1' ||
    hostname === '0.0.0.0' ||
    hostname.startsWith('10.') ||
    hostname.startsWith('192.168.') ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname) ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.localhost')
  ) {
    return { valid: false, error: 'Requests to private/internal networks are not allowed' };
  }

  return { valid: true };
}

interface TestResult {
  success: boolean;
  frontend?: {
    success: boolean;
    loadTimeMs?: number;
    moduleName?: string;
    errors: string[];
  };
  backend?: {
    success: boolean;
    responseTimeMs?: number;
    healthStatus?: string;
    errors: string[];
  };
  overallErrors: string[];
}

async function testFrontendLoading(
  frontendUrl: string,
  timeout: number = 15000
): Promise<{ success: boolean; loadTimeMs?: number; errors: string[] }> {
  const testErrors: string[] = [];
  const startTime = Date.now();

  try {
    const urlCheck = validateExternalUrl(frontendUrl);
    if (!urlCheck.valid) {
      return { success: false, errors: [urlCheck.error || 'Invalid URL'] };
    }

    // Verify URL is accessible
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    const response = await fetch(frontendUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'Accept': '*/*',
      },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      testErrors.push(`Frontend URL returned ${response.status}: ${response.statusText}`);
      return { success: false, errors: testErrors };
    }

    // Verify it's JavaScript content
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('javascript') && !contentType.includes('text/plain')) {
      testErrors.push(`Expected JavaScript content, got: ${contentType}`);
    }

    // Verify content contains expected UMD bundle markers
    const content = await response.text();
    if (!content.includes('NaapPlugin') && !content.includes('.mount') && !content.includes('typeof exports')) {
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

async function testBackendHealth(
  backendUrl: string,
  timeout: number = 5000
): Promise<{ success: boolean; responseTimeMs?: number; healthStatus?: string; errors: string[] }> {
  const testErrors: string[] = [];
  const startTime = Date.now();

  try {
    const urlCheck = validateExternalUrl(backendUrl);
    if (!urlCheck.valid) {
      return { success: false, responseTimeMs: 0, healthStatus: undefined, errors: [urlCheck.error || 'Invalid URL'] };
    }

    // Determine health endpoint
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

    // Validate CSRF token
    const csrfError = validateCSRF(request, token);
    if (csrfError) {
      return csrfError;
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    const body = await request.json();
    const { frontendUrl, backendUrl } = body;

    if (!frontendUrl && !backendUrl) {
      return errors.badRequest('Either frontendUrl or backendUrl is required');
    }

    const result: TestResult = {
      success: true,
      overallErrors: [],
    };

    // Test frontend if URL provided
    if (frontendUrl) {
      result.frontend = await testFrontendLoading(frontendUrl);
      if (!result.frontend.success) {
        result.success = false;
        result.overallErrors.push(...result.frontend.errors);
      }
    }

    // Test backend if URL provided
    if (backendUrl) {
      result.backend = await testBackendHealth(backendUrl);
      if (!result.backend.success) {
        result.success = false;
        result.overallErrors.push(...result.backend.errors);
      }
    }

    return success(result);
  } catch (err) {
    console.error('Test error:', err);
    return success({
      success: false,
      overallErrors: [err instanceof Error ? err.message : 'Test failed'],
    });
  }
}
