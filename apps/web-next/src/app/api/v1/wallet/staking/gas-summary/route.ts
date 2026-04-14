import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { errors, getAuthToken } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    return NextResponse.json({
      data: {
        totalGasUsed: '0',
        totalGasCostWei: '0',
        totalGasCostEth: 0,
        transactionCount: 0,
        avgGasPerTx: 0,
        byType: {},
      },
    });
  } catch (err) {
    console.error('[staking/gas-summary] Error:', err);
    return errors.internal('Failed to fetch gas summary');
  }
}
