/**
 * Dashboard Embed Verify API Route
 * GET /api/v1/dashboard/embed/verify - Verify Metabase configuration
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { success, errors } from '@/lib/api/response';

export async function GET(_request: NextRequest): Promise<NextResponse> {
  try {
    const rows = await prisma.dashboardPluginConfig.findMany();
    const config: Record<string, string> = {};
    for (const row of rows) {
      config[row.key] = row.value;
    }

    const valid = !!(config.metabaseUrl && config.metabaseSecretKey);

    return success({
      valid,
      metabaseUrl: config.metabaseUrl || null,
      hasSecretKey: !!config.metabaseSecretKey,
      ...(valid ? {} : { error: 'Metabase URL or Secret Key not configured' }),
    });
  } catch (err) {
    console.error('Error verifying embed config:', err);
    return errors.internal('Failed to verify configuration');
  }
}
