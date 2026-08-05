/**
 * GET  /api/v1/orchestrator-leaderboard/bundles/config — list resolved signer bundles (admin)
 * PUT  /api/v1/orchestrator-leaderboard/bundles/config — update bundle overrides (admin)
 *
 * Persists overrides on the sentinel LeaderboardSource row `signer-bundle-config`.
 */

export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import {
  listSignerBundles,
  updateSignerBundlesConfig,
} from '@/lib/orchestrator-leaderboard/signer-bundle-config';
import {
  SIGNER_BUNDLE_DISCOVERY_FLAG,
  SignerBundlesConfigSchema,
  isSignerBundleDiscoveryEnabled,
} from '@/lib/orchestrator-leaderboard/signer-bundle-types';

async function requireAdmin(request: NextRequest) {
  const token = getAuthToken(request);
  if (!token) return { error: errors.unauthorized() as Response };
  const user = await validateSession(token);
  if (!user) return { error: errors.unauthorized('Invalid session') as Response };
  if (!user.roles.includes('system:admin')) {
    return { error: errors.forbidden('Admin permission required') as Response };
  }
  return { user };
}

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await requireAdmin(request);
  if ('error' in auth && auth.error) return auth.error;

  try {
    const bundles = await listSignerBundles();
    return success({
      enabled: isSignerBundleDiscoveryEnabled(),
      flag: SIGNER_BUNDLE_DISCOVERY_FLAG,
      bundles,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to read bundle config';
    return errors.internal(message);
  }
}

export async function PUT(request: NextRequest): Promise<Response> {
  const auth = await requireAdmin(request);
  if ('error' in auth && auth.error) return auth.error;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errors.badRequest('Invalid JSON body');
  }

  const parsed = SignerBundlesConfigSchema.safeParse(body);
  if (!parsed.success) {
    return errors.badRequest(parsed.error.issues[0]?.message ?? 'Invalid bundle config');
  }

  try {
    const bundles = await updateSignerBundlesConfig(parsed.data);
    return success({
      enabled: isSignerBundleDiscoveryEnabled(),
      flag: SIGNER_BUNDLE_DISCOVERY_FLAG,
      bundles,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to update bundle config';
    return errors.internal(message);
  }
}
