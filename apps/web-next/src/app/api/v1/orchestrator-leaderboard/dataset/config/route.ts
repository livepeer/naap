/**
 * GET  /api/v1/orchestrator-leaderboard/dataset/config — read config (admin only)
 * PUT  /api/v1/orchestrator-leaderboard/dataset/config — update interval + strategy (admin only)
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import {
  getConfig,
  updateConfig,
  isValidInterval,
  getMembershipStrategy,
  updateMembershipStrategy,
} from '@/lib/orchestrator-leaderboard/config';

export async function GET(request: NextRequest): Promise<NextResponse | Response> {
  const token = getAuthToken(request);
  if (!token) return errors.unauthorized();

  const user = await validateSession(token);
  if (!user || !user.roles.includes('system:admin')) {
    return errors.forbidden('Admin permission required');
  }

  try {
    const config = await getConfig();
    const membershipStrategy = await getMembershipStrategy();
    return success({ ...config, membershipStrategy });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read config';
    return errors.internal(message);
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse | Response> {
  const token = getAuthToken(request);
  if (!token) return errors.unauthorized();

  const user = await validateSession(token);
  if (!user) return errors.unauthorized('Invalid session');

  if (!user.roles.includes('system:admin')) {
    return errors.forbidden('Admin permission required');
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errors.badRequest('Invalid JSON body');
  }

  const { refreshIntervalHours, membershipStrategy } = body as {
    refreshIntervalHours?: unknown;
    membershipStrategy?: unknown;
  };

  if (membershipStrategy !== undefined) {
    if (membershipStrategy !== 'union' && membershipStrategy !== 'intersection') {
      return errors.badRequest('membershipStrategy must be "union" or "intersection"');
    }
    await updateMembershipStrategy(membershipStrategy);
  }

  if (refreshIntervalHours !== undefined) {
    if (!isValidInterval(refreshIntervalHours)) {
      return errors.badRequest('refreshIntervalHours must be one of: 1, 4, 8, 12');
    }
    try {
      const config = await updateConfig(refreshIntervalHours);
      const strategy = await getMembershipStrategy();
      return success({ ...config, membershipStrategy: strategy });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to update config';
      return errors.internal(message);
    }
  }

  const config = await getConfig();
  const strategy = await getMembershipStrategy();
  return success({ ...config, membershipStrategy: strategy });
}
