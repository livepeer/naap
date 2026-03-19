/**
 * Get auto-claim config for a wallet address (S17)
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ walletAddressId: string }> },
) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const { walletAddressId } = await params;

    // Verify ownership
    const addr = await prisma.walletAddress.findFirst({ where: { id: walletAddressId, userId: user.id } });
    if (!addr) return errors.notFound('Wallet address not found');

    const config = await prisma.walletAutoClaimConfig.findUnique({ where: { walletAddressId } });

    return success(config ? {
      id: config.id,
      walletAddressId: config.walletAddressId,
      enabled: config.enabled,
      minRewardLpt: config.minRewardLpt.toString(),
      lastClaimedAt: config.lastClaimedAt?.toISOString() || null,
    } : null);
  } catch (err) {
    console.error('Auto-claim get error:', err);
    return errors.internal('Failed to get auto-claim config');
  }
}
