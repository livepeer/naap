/**
 * Wallet Staking Orchestrators API Routes
 * GET /api/v1/wallet/staking/orchestrators - List orchestrators
 *
 * Mirrors the Express backend: always fetches live data from the subgraph.
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { errors, getAuthToken } from '@/lib/api/response';
import { getOrchestrators } from '@/lib/wallet/subgraph';

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

    const orchestrators = await getOrchestrators();

    return NextResponse.json({ data: { orchestrators } });
  } catch (err) {
    console.error('Error fetching orchestrators:', err);
    return errors.internal('Failed to fetch orchestrators');
  }
}
