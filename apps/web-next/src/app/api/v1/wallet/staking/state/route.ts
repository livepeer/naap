/**
 * Wallet Staking State API Routes
 * GET /api/v1/wallet/staking/state - Get staking state
 * POST /api/v1/wallet/staking/state - Update staking state
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

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
    const address = searchParams.get('address');

    if (!address) {
      return errors.badRequest('address is required');
    }

    const state = await prisma.walletStakingState.findUnique({
      where: { address },
    });

    return success({ state: state || null });
  } catch (err) {
    console.error('Error fetching staking state:', err);
    return errors.internal('Failed to fetch staking state');
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
    const {
      address,
      chainId,
      stakedAmount,
      delegatedTo,
      pendingRewards,
      pendingFees,
      startRound,
      lastClaimRound,
    } = body;

    if (!address || !chainId) {
      return errors.badRequest('address and chainId are required');
    }

    const state = await prisma.walletStakingState.upsert({
      where: { address },
      update: {
        chainId,
        stakedAmount,
        delegatedTo,
        pendingRewards,
        pendingFees,
        startRound,
        lastClaimRound,
        lastSynced: new Date(),
      },
      create: {
        address,
        chainId,
        stakedAmount: stakedAmount || '0',
        delegatedTo,
        pendingRewards: pendingRewards || '0',
        pendingFees: pendingFees || '0',
        startRound,
        lastClaimRound,
      },
    });

    return success({ state });
  } catch (err) {
    console.error('Error updating staking state:', err);
    return errors.internal('Failed to update staking state');
  }
}
