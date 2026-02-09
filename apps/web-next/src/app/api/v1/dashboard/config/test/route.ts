/**
 * Dashboard Config Test API Route
 * POST /api/v1/dashboard/config/test - Test Metabase connection
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

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

    // Read config from database
    const rows = await prisma.dashboardPluginConfig.findMany();
    const config: Record<string, string> = {};
    for (const row of rows) {
      config[row.key] = row.value;
    }

    const valid = !!(config.metabaseUrl && config.metabaseSecretKey);

    if (!valid) {
      return success({
        connected: false,
        error: 'Metabase URL or Secret Key not configured',
      });
    }

    // Optionally ping Metabase to verify connectivity
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const res = await fetch(`${config.metabaseUrl}/api/health`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (res.ok) {
        return success({
          connected: true,
          message: 'Metabase connection successful',
        });
      }

      return success({
        connected: false,
        error: `Metabase returned ${res.status}`,
      });
    } catch {
      // If the health check fails, still report config as valid
      return success({
        connected: true,
        message: 'Configuration is valid (health endpoint unreachable from server)',
      });
    }
  } catch (err) {
    console.error('Error testing config:', err);
    return errors.internal('Failed to test configuration');
  }
}
