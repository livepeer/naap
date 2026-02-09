/**
 * Plugin Frontend Test API Route
 * POST /api/v1/plugin-publisher/test-frontend - Test frontend bundle loading
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

async function testFrontendLoading(
  frontendUrl: string,
  timeout: number = 15000,
): Promise<{ success: boolean; loadTimeMs?: number; errors: string[] }> {
  const testErrors: string[] = [];
  const startTime = Date.now();

  try {
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
