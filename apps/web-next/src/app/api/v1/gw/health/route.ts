/**
 * Service Gateway — Health Check
 * GET /api/v1/gw/health
 *
 * Returns basic health status for the gateway plugin.
 */

export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    success: true,
    data: {
      status: 'ok',
      plugin: 'service-gateway',
      version: '1.0.0',
      timestamp: new Date().toISOString(),
    },
  });
}
