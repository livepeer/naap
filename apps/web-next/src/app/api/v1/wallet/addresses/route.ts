/**
 * Wallet Addresses API Routes
 * GET /api/v1/wallet/addresses - List all wallet addresses for current user
 * POST /api/v1/wallet/addresses - Add a new wallet address
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

const isValidAddress = (address: string): boolean => /^0x[a-fA-F0-9]{40}$/.test(address);
const isValidChainId = (chainId: number): boolean => [1, 5, 42161, 421613].includes(chainId);

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');

    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const addresses = await prisma.walletAddress.findMany({
      where: { userId: user.id },
      orderBy: [{ isPrimary: 'desc' }, { connectedAt: 'asc' }],
    });

    return success({ addresses });
  } catch (err) {
    console.error('Error fetching wallet addresses:', err);
    return errors.internal('Failed to fetch wallet addresses');
  }
}

export async function POST(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');

    const csrfError = validateCSRF(request, token);
    if (csrfError) return csrfError;

    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const body = await request.json();
    const { address, chainId, label } = body;

    if (!address || chainId === undefined) {
      return errors.badRequest('address and chainId are required');
    }
    if (!isValidAddress(address)) {
      return errors.badRequest('Invalid Ethereum address format');
    }
    if (!isValidChainId(chainId)) {
      return errors.badRequest('Unsupported chain ID');
    }
    if (label && (typeof label !== 'string' || label.length > 50)) {
      return errors.badRequest('Label must be a string of at most 50 characters');
    }

    // Check if this address+chain already exists for this user
    const existing = await prisma.walletAddress.findFirst({
      where: { userId: user.id, address, chainId },
    });
    if (existing) {
      return errors.conflict('This address is already registered');
    }

    // First address becomes primary
    const count = await prisma.walletAddress.count({ where: { userId: user.id } });

    const walletAddress = await prisma.walletAddress.create({
      data: {
        userId: user.id,
        address,
        chainId,
        label: label || null,
        isPrimary: count === 0,
      },
    });

    return success({ address: walletAddress });
  } catch (err) {
    console.error('Error creating wallet address:', err);
    return errors.internal('Failed to create wallet address');
  }
}
