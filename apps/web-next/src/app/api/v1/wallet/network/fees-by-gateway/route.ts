/**
 * Fee breakdown by gateway (broadcaster).
 * Uses subgraph BroadcasterDay entities with human-readable gateway names.
 * Returns time-series array matching the Express backend shape.
 */

import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { errors, getAuthToken } from '@/lib/api/response';
import { querySubgraph } from '@/lib/wallet/subgraph';

const KNOWN_GATEWAYS: Record<string, string> = {
  '0xc3c7c4c8f7061b7d6a72766eee5359fe4f36e61e': 'Livepeer Studio',
  '0xca3331d67e87816adb30d9562a6e8c0623fb7fef': 'Livepeer Gateway',
  '0x5f51c8eae3c97364613c48b42824be47aeb47ad0': 'Livepeer Gateway 2',
  '0x5ae4e42db3671370a0c25aff451e7482aaec3d0b': 'Livepeer Gateway 3',
  '0x012345de92b630c065dfc0cabe4eb34f74f7fc85': 'Livepeer Dev',
  '0x847791cbf03be716a7fe9dc8c9affe17bd49ae5e': 'Livepeer AI Gateway',
};

function resolveGatewayName(address: string): string {
  const known = KNOWN_GATEWAYS[address.toLowerCase()];
  if (known) return known;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) return errors.unauthorized('No auth token provided');
    const user = await validateSession(token);
    if (!user) return errors.unauthorized('Invalid or expired session');

    const days = parseInt(request.nextUrl.searchParams.get('days') || '90', 10);

    let series: Array<Record<string, number>> = [];
    let allGateways: string[] = [];
    let gatewaySummary: any[] = [];

    try {
      const topGatewayData = await querySubgraph<{
        broadcasters: Array<{ id: string; totalVolumeETH: string }>;
      }>(`{
        broadcasters(first: 10, orderBy: totalVolumeETH, orderDirection: desc) {
          id
          totalVolumeETH
        }
      }`);

      const gwIds = topGatewayData.broadcasters.map((b) => b.id);
      const gwLabels = new Map(
        topGatewayData.broadcasters.map((b) => [b.id, resolveGatewayName(b.id)]),
      );

      const gwFilter = gwIds.map((id) => `"${id}"`).join(',');
      const cutoffTs = Math.floor((Date.now() - days * 86400000) / 1000);

      const bdData = await querySubgraph<{
        broadcasterDays: Array<{
          date: number;
          volumeETH: string;
          broadcaster: { id: string };
        }>;
      }>(`{
        broadcasterDays(
          first: 1000
          orderBy: date
          orderDirection: desc
          where: { volumeETH_gt: "0", broadcaster_in: [${gwFilter}] }
        ) {
          date
          volumeETH
          broadcaster { id }
        }
      }`);

      const byDate = new Map<number, Record<string, number>>();

      for (const bd of bdData.broadcasterDays || []) {
        if (bd.date < cutoffTs) continue;
        const vol = parseFloat(bd.volumeETH);
        if (vol === 0) continue;
        const label = gwLabels.get(bd.broadcaster.id) || bd.broadcaster.id.slice(0, 10);

        if (!byDate.has(bd.date)) byDate.set(bd.date, {});
        const bucket = byDate.get(bd.date)!;
        bucket[label] = (bucket[label] || 0) + vol;
      }

      series = [...byDate.entries()]
        .sort(([a], [b]) => a - b)
        .map(([date, gws]) => ({ date: date * 1000, ...gws }));

      allGateways = [...new Set(
        (bdData.broadcasterDays || [])
          .filter((bd) => bd.date >= cutoffTs)
          .map((bd) => gwLabels.get(bd.broadcaster.id) || bd.broadcaster.id.slice(0, 10)),
      )];

      gatewaySummary = topGatewayData.broadcasters.map((b) => ({
        address: b.id,
        label: gwLabels.get(b.id)!,
        totalVolumeETH: b.totalVolumeETH,
      }));
    } catch {
      // subgraph unavailable
    }

    return NextResponse.json({ data: { series, gateways: allGateways, gatewaySummary } });
  } catch (err) {
    console.error('[network/fees-by-gateway] Error:', err);
    return errors.internal('Failed to fetch fees by gateway');
  }
}
