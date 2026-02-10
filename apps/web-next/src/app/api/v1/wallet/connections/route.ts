/**
 * Wallet Connections API Routes
 * GET /api/v1/wallet/connections - Get wallet connection
 * POST /api/v1/wallet/connections - Create/update wallet connection
 * DELETE /api/v1/wallet/connections - Delete wallet connection
 */

import {NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

// Validation helpers
const isValidAddress = (address: string): boolean => {
  return /^0x[a-fA-F0-9]{40}$/.test(address);
};

const isValidChainId = (chainId: number): boolean => {
  return [1, 5, 42161, 421613].includes(chainId);
};

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

    const searchParams = request.nextUrl.searchParams;
    const userId = searchParams.get('userId') || user.id;
    const address = searchParams.get('address');

    const where = address ? { address } : { userId };
    const connection = await prisma.walletConnection.findFirst({ where });

    return success({ connection });
  } catch (err) {
    console.error('Error fetching wallet connection:', err);
    return errors.internal('Failed to fetch wallet connection');
  }
}

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

    const body = await request.json();
    const { address, chainId } = body;

    if (!address || !chainId) {
      return errors.badRequest('address and chainId are required');
    }

    if (!isValidAddress(address)) {
      return errors.badRequest('Invalid Ethereum address format');
    }

    if (!isValidChainId(chainId)) {
      return errors.badRequest('Unsupported chain ID');
    }

    const connection = await prisma.walletConnection.upsert({
      where: { userId: user.id },
      update: {
        address,
        chainId,
        lastSeen: new Date(),
      },
      create: {
        userId: user.id,
        address,
        chainId,
      },
    });

    return success({ connection });
  } catch (err) {
    console.error('Error saving wallet connection:', err);
    return errors.internal('Failed to save wallet connection');
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
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

    await prisma.walletConnection.deleteMany({
      where: { userId: user.id },
    });

    return success({ deleted: true });
  } catch (err) {
    console.error('Error deleting wallet connection:', err);
    return errors.internal('Failed to delete wallet connection');
  }
}
