/**
 * Auto-claim config endpoint (S17)
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const csrfError = validateCSRF(request, token);
    if (csrfError) return csrfError;
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const body = await request.json();
    const { walletAddressId, enabled, minRewardLpt } = body;
    if (!walletAddressId || minRewardLpt === undefined) {
      return errors.badRequest('walletAddressId and minRewardLpt are required');
    }

    // Verify ownership
    const addr = await prisma.walletAddress.findFirst({ where: { id: walletAddressId, userId: user.id } });
    if (!addr) return errors.notFound('Wallet address not found');

    const config = await prisma.walletAutoClaimConfig.upsert({
      where: { walletAddressId },
      update: { enabled: enabled ?? false, minRewardLpt },
      create: { walletAddressId, enabled: enabled ?? false, minRewardLpt },
    });

    return success({
      id: config.id,
      walletAddressId: config.walletAddressId,
      enabled: config.enabled,
      minRewardLpt: config.minRewardLpt.toString(),
      lastClaimedAt: config.lastClaimedAt?.toISOString() || null,
    });
  } catch (err) {
    console.error('Auto-claim config error:', err);
    return errors.internal('Failed to set auto-claim config');
  }
}
