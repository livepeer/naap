/**
 * Dashboard Embed API Route
 * GET /api/v1/dashboard/embed/:id - Get signed embed URL for a dashboard
 */

import { NextRequest, NextResponse } from 'next/server';
import * as crypto from 'crypto';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * Retrieve dashboard plugin config entries as a key-value map.
 */
async function getDashboardConfig(): Promise<Record<string, string>> {
  const rows = await prisma.dashboardPluginConfig.findMany();
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.key] = row.value;
  }
  return map;
}

/**
 * Generate a signed Metabase embed URL using HS256 JWT.
 */
function generateEmbedUrl(
  metabaseUrl: string,
  secretKey: string,
  metabaseId: number,
  params?: Record<string, string>,
): { embedUrl: string; token: string } {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      resource: { dashboard: metabaseId },
      params: params || {},
      exp: Math.floor(Date.now() / 1000) + 600, // 10 min
    }),
  ).toString('base64url');

  const signature = crypto
    .createHmac('sha256', secretKey)
    .update(`${header}.${payload}`)
    .digest('base64url');

  const token = `${header}.${payload}.${signature}`;
  const embedUrl = `${metabaseUrl}/embed/dashboard/${token}#bordered=true&titled=true`;

  return { embedUrl, token };
}

export async function GET(request: NextRequest, { params }: RouteParams): Promise<NextResponse> {
  try {
    const { id } = await params;

    // Optional auth — enrich embed token with userId when available
    const authToken = getAuthToken(request);
    if (authToken) {
      // Validate the session (enriches embed context if needed in the future)
      await validateSession(authToken);
    }

    // Verify Metabase is configured
    const config = await getDashboardConfig();
    if (!config.metabaseUrl || !config.metabaseSecretKey) {
      return errors.serviceUnavailable('Metabase is not configured');
    }

    // Find the dashboard
    const dashboard = await prisma.dashboard.findUnique({
      where: { id },
    });

    if (!dashboard) {
      return errors.notFound('Dashboard');
    }

    // Collect filter parameters from query string (param_xxx=yyy)
    const filterParams: Record<string, string> = {};
    const searchParams = request.nextUrl.searchParams;
    for (const [key, value] of searchParams.entries()) {
      if (key.startsWith('param_')) {
        filterParams[key.replace('param_', '')] = value;
      }
    }

    // Generate signed embed URL
    const embed = generateEmbedUrl(
      config.metabaseUrl,
      config.metabaseSecretKey,
      dashboard.metabaseId,
      Object.keys(filterParams).length > 0 ? filterParams : undefined,
    );

    return success(embed);
  } catch (err) {
    console.error('Error generating embed URL:', err);
    return errors.internal('Failed to generate embed URL');
  }
}
