import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { errors, getAuthToken } from '@/lib/api/response';
import { querySubgraph } from '@/lib/wallet/subgraph';

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const days = Math.min(
      Math.max(1, parseInt(request.nextUrl.searchParams.get('days') || '30', 10)),
      90,
    );

    let gateways: any[] = [];
    let series: Record<string, number[]> = {};
    let gatewaySummary: any[] = [];

    try {
      const data = await querySubgraph<{ broadcasters: any[] }>(`{
        broadcasters(first: 50, orderBy: totalVolumeETH, orderDirection: desc) {
          id totalVolumeETH
        }
      }`);

      gateways = (data.broadcasters || []).map((b: any) => ({
        id: b.id,
        totalVolumeETH: b.totalVolumeETH || '0',
      }));

      const topGateways = gateways.slice(0, 10);
      const sinceTs = Math.floor(Date.now() / 1000) - days * 86400;

      const dayData = await querySubgraph<{ broadcasterDays: any[] }>(`{
        broadcasterDays(first: 1000, orderBy: date, orderDirection: desc, where: { date_gte: ${sinceTs} }) {
          date broadcaster { id } volumeETH
        }
      }`);

      const byGateway: Record<string, Map<number, number>> = {};
      for (const g of topGateways) byGateway[g.id] = new Map();

      for (const bd of dayData.broadcasterDays || []) {
        const id = bd.broadcaster?.id;
        if (!byGateway[id]) continue;
        byGateway[id].set(bd.date, parseFloat(bd.volumeETH || '0'));
      }

      for (const g of topGateways) {
        const entries = [...(byGateway[g.id]?.entries() || [])].sort((a, b) => a[0] - b[0]);
        series[g.id] = entries.map(([, v]) => v);
      }

      gatewaySummary = topGateways.map((g) => ({
        address: g.id,
        totalVolumeETH: g.totalVolumeETH,
        periodVolumeETH: (series[g.id] || []).reduce((s, v) => s + v, 0).toString(),
      }));
    } catch {
      // fallback to empty
    }

    return NextResponse.json({ data: { series, gateways, gatewaySummary } });
  } catch (err) {
    console.error('[network/fees-by-gateway] Error:', err);
    return errors.internal('Failed to fetch fees by gateway');
  }
}
