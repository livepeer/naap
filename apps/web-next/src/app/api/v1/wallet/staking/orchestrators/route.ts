/**
 * Wallet Staking Orchestrators API Routes
 * GET /api/v1/wallet/staking/orchestrators - List orchestrators
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

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

    const searchParams = request.nextUrl.searchParams;
    const chainId = searchParams.get('chainId');
    const activeOnly = searchParams.get('activeOnly') !== 'false';

    const where: {
      chainId?: number;
      isActive?: boolean;
    } = {};

    if (chainId) where.chainId = parseInt(chainId, 10);
    if (activeOnly) where.isActive = true;

    const orchestrators = await prisma.walletOrchestrator.findMany({
      where,
      orderBy: { totalStake: 'desc' },
    });

    return success({ orchestrators });
  } catch (err) {
    console.error('Error fetching orchestrators:', err);
    return errors.internal('Failed to fetch orchestrators');
  }
}
