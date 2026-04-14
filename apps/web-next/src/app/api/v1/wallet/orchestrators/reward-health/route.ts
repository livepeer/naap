import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { errors, getAuthToken } from '@/lib/api/response';
import { getOrchestrators, getProtocol } from '@/lib/wallet/subgraph';

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    let orchestrators: any[] = [];
    let currentRound = 0;
    try {
      [orchestrators, { currentRound }] = await Promise.all([
        getOrchestrators(),
        getProtocol().then((p) => ({ currentRound: p.currentRound })),
      ]);
    } catch {
      return NextResponse.json({
        data: { best: [], worst: [], totalOrchestrators: 0, currentRound: 0 },
      });
    }

    const scored = orchestrators.map((o) => {
      const rewardCutScore = Math.max(0, 100 - o.rewardCut);
      const callRatioScore = o.rewardCallRatio * 100;
      const health = Math.round((rewardCutScore * 0.4 + callRatioScore * 0.6) * 100) / 100;
      return { ...o, healthScore: health };
    });

    scored.sort((a, b) => b.healthScore - a.healthScore);

    const best = scored.slice(0, 10);
    const worst = scored.slice(-10).reverse();

    return NextResponse.json({
      data: {
        best,
        worst,
        totalOrchestrators: scored.length,
        currentRound,
      },
    });
  } catch (err) {
    console.error('[orchestrators/reward-health] Error:', err);
    return errors.internal('Failed to fetch reward health');
  }
}
