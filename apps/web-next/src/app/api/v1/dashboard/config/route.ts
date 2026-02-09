/**
 * Dashboard Plugin Config API Routes
 * GET  /api/v1/dashboard/config - Get plugin configuration
 * PUT  /api/v1/dashboard/config - Update plugin configuration
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

/**
 * Read all DashboardPluginConfig rows into a key-value object.
 */
async function readConfig(): Promise<Record<string, string>> {
  const rows = await prisma.dashboardPluginConfig.findMany();
  const map: Record<string, string> = {};
  for (const row of rows) {
    map[row.key] = row.value;
  }
  return map;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    const config = await readConfig();

    // Mask the secret key for security
    const maskedConfig = {
      ...config,
      metabaseSecretKey: config.metabaseSecretKey
        ? `${config.metabaseSecretKey.substring(0, 8)}...`
        : '',
    };

    return success(maskedConfig);
  } catch (err) {
    console.error('Error fetching config:', err);
    return errors.internal('Failed to fetch configuration');
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
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
    const { metabaseUrl, metabaseSecretKey, tokenExpiry, enableInteractive } = body;

    // Build updates map
    const updates: Record<string, string> = {};
    if (metabaseUrl !== undefined) updates.metabaseUrl = String(metabaseUrl);
    if (metabaseSecretKey !== undefined) updates.metabaseSecretKey = String(metabaseSecretKey);
    if (tokenExpiry !== undefined) updates.tokenExpiry = String(tokenExpiry);
    if (enableInteractive !== undefined) updates.enableInteractive = String(enableInteractive);

    // Upsert each config entry
    await prisma.$transaction(
      Object.entries(updates).map(([key, value]) =>
        prisma.dashboardPluginConfig.upsert({
          where: { key },
          update: { value },
          create: { key, value },
        }),
      ),
    );

    // Re-read and verify
    const config = await readConfig();
    const valid = !!(config.metabaseUrl && config.metabaseSecretKey);

    return success({
      saved: true,
      valid,
      ...(valid ? {} : { validationMessage: 'Metabase URL or Secret Key not set' }),
    });
  } catch (err) {
    console.error('Error saving config:', err);
    return errors.internal('Failed to save configuration');
  }
}
