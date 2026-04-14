import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { errors, getAuthToken } from '@/lib/api/response';

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const capabilities = await prisma.walletOrchestratorCapability.findMany({
      orderBy: { address: 'asc' },
    });

    const byAddress: Record<string, any[]> = {};
    for (const cap of capabilities) {
      if (!byAddress[cap.address]) byAddress[cap.address] = [];
      byAddress[cap.address].push({
        category: cap.category,
        pipelineId: cap.pipelineId,
        lastChecked: cap.lastChecked,
      });
    }

    return NextResponse.json({ data: byAddress });
  } catch (err) {
    console.error('[orchestrators/capabilities] Error:', err);
    return errors.internal('Failed to fetch orchestrator capabilities');
  }
}
