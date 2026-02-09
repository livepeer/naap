/**
 * Wallet Settings API Routes
 * GET /api/v1/wallet/settings - Get user settings
 * POST /api/v1/wallet/settings - Update user settings
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

const DEFAULT_SETTINGS = {
  defaultNetwork: 'arbitrum-one',
  autoConnect: true,
  showTestnets: false,
  gasStrategy: 'standard',
};

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    const settings = await prisma.walletSettings.findUnique({
      where: { userId: user.id },
    });

    return success({
      settings: settings || DEFAULT_SETTINGS,
    });
  } catch (err) {
    console.error('Error fetching settings:', err);
    return errors.internal('Failed to fetch settings');
  }
}

export async function POST(request: NextRequest) {
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
    const { defaultNetwork, autoConnect, showTestnets, gasStrategy } = body;

    const settings = await prisma.walletSettings.upsert({
      where: { userId: user.id },
      update: {
        ...(defaultNetwork !== undefined && { defaultNetwork }),
        ...(autoConnect !== undefined && { autoConnect }),
        ...(showTestnets !== undefined && { showTestnets }),
        ...(gasStrategy !== undefined && { gasStrategy }),
      },
      create: {
        userId: user.id,
        defaultNetwork: defaultNetwork || DEFAULT_SETTINGS.defaultNetwork,
        autoConnect: autoConnect ?? DEFAULT_SETTINGS.autoConnect,
        showTestnets: showTestnets ?? DEFAULT_SETTINGS.showTestnets,
        gasStrategy: gasStrategy || DEFAULT_SETTINGS.gasStrategy,
      },
    });

    return success({ settings });
  } catch (err) {
    console.error('Error updating settings:', err);
    return errors.internal('Failed to update settings');
  }
}
