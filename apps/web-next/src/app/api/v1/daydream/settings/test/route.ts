/**
 * Daydream Settings Test API Route
 * POST /api/v1/daydream/settings/test - Test API key connection against Daydream.live
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

const DAYDREAM_API = 'https://api.daydream.live';

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
    const { apiKey: testKey } = body;

    // Use provided key or fallback to stored key
    let apiKey = testKey;
    if (!apiKey) {
      const settings = await prisma.daydreamSettings.findUnique({
        where: { userId: user.id },
      });
      apiKey = settings?.apiKey;
    }

    if (!apiKey) {
      return errors.badRequest('No API key provided or stored');
    }

    // Test by listing models from Daydream API
    const response = await fetch(`${DAYDREAM_API}/v1/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!response.ok) {
      return errors.badRequest('Failed to connect to Daydream API. Check your API key.');
    }

    const data = await response.json();
    const models = Array.isArray(data) ? data : data.models || data.data || [];

    return success({
      message: 'Daydream API connection successful',
      modelsAvailable: models.length,
    });
  } catch (err) {
    console.error('API key test failed:', err);
    return errors.badRequest('Failed to connect to Daydream API. Check your API key.');
  }
}
