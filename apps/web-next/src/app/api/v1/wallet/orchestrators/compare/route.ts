/**
 * Orchestrator Comparison API
 * GET /api/v1/wallet/orchestrators/compare?addresses=0x1,0x2
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const addrParam = request.nextUrl.searchParams.get('addresses');
    if (!addrParam) return errors.badRequest('addresses query param is required');

    const addresses = addrParam.split(',').map(a => a.trim()).filter(Boolean);
    if (addresses.length === 0 || addresses.length > 4) {
      return errors.badRequest('Provide 1-4 orchestrator addresses');
    }

    const orchestrators = await prisma.walletOrchestrator.findMany({
      where: { address: { in: addresses } },
    });

    return success({ orchestrators });
  } catch (err) {
    console.error('Error comparing orchestrators:', err);
    return errors.internal('Failed to compare orchestrators');
  }
}
