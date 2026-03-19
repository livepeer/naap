/**
 * Network overview route — Dune-style dashboard data.
 * Uses DB snapshots for charts. Falls back to live subgraph/RPC for current
 * stats when DB data has zeros (e.g. delegatorsCount, totalVolumeETH).
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../db/client.js';
import { getPrices, getProtocol, getOrchestrators } from '../lib/livepeer.js';

const router = Router();

const KNOWN_GATEWAYS: Record<string, string> = {
  '0xc3c7c4c8f7061b7d6a72766eee5359fe4f36e61e': 'Livepeer Studio',
  '0xca3331d67e87816adb30d9562a6e8c0623fb7fef': 'Livepeer Gateway',
  '0x5f51c8eae3c97364613c48b42824be47aeb47ad0': 'Livepeer Gateway 2',
  '0x5ae4e42db3671370a0c25aff451e7482aaec3d0b': 'Livepeer Gateway 3',
  '0x012345de92b630c065dfc0cabe4eb34f74f7fc85': 'Livepeer Dev',
  '0x847791cbf03be716a7fe9dc8c9affe17bd49ae5e': 'Livepeer AI Gateway',
};

function resolveGatewayName(address: string): string {
  const lower = address.toLowerCase();
  const known = KNOWN_GATEWAYS[lower];
  if (known) return known;
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

router.get('/api/v1/wallet/network/overview', async (req: Request, res: Response) => {
  try {
    const days = Math.min(parseInt((req.query.days as string) || '90'), 365);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [snapshots, dbOrchestrators, prices, latestSnapshot, protocol] = await Promise.all([
      prisma.walletNetworkSnapshot.findMany({
        where: { snapshotAt: { gte: cutoff } },
        orderBy: { round: 'asc' },
      }),
      prisma.walletOrchestrator.findMany({
        where: { isActive: true },
        orderBy: { totalStake: 'desc' },
        take: 20,
        select: {
          address: true,
          name: true,
          totalStake: true,
          rewardCut: true,
          feeShare: true,
          totalVolumeETH: true,
          thirtyDayVolumeETH: true,
          delegatorCount: true,
          rewardCallRatio: true,
          isActive: true,
          capabilities: { select: { category: true } },
        },
      }),
      getPrices(),
      prisma.walletNetworkSnapshot.findFirst({
        orderBy: { round: 'desc' },
      }),
      getProtocol(),
    ]);

    // Build current stats: prefer live protocol data which has delegatorsCount
    // and totalVolumeETH from the subgraph even when DB snapshot has zeros.
    const current = {
      totalBonded: protocol.totalActiveStake || latestSnapshot?.totalBonded || '0',
      totalSupply: protocol.totalSupply || latestSnapshot?.totalSupply || '0',
      participationRate: protocol.participationRate || latestSnapshot?.participationRate || 0,
      activeOrchestrators: protocol.activeTranscoderCount || latestSnapshot?.activeOrchestrators || 0,
      delegatorsCount: protocol.delegatorsCount || latestSnapshot?.delegatorsCount || 0,
      totalVolumeETH: protocol.totalVolumeETH || latestSnapshot?.totalVolumeETH || '0',
      totalVolumeUSD: protocol.totalVolumeUSD || latestSnapshot?.totalVolumeUSD || '0',
      inflation: protocol.inflation || latestSnapshot?.inflation || '0',
    };

    // Enrich DB orchestrators with live subgraph data when DB has zeros
    let topOrchestrators = dbOrchestrators.map((o) => ({
      address: o.address,
      name: o.name,
      totalStake: o.totalStake,
      rewardCut: o.rewardCut,
      feeShare: o.feeShare,
      totalVolumeETH: o.totalVolumeETH,
      thirtyDayVolumeETH: o.thirtyDayVolumeETH,
      delegatorCount: o.delegatorCount,
      rewardCallRatio: o.rewardCallRatio,
      isActive: o.isActive,
      categories: [...new Set(o.capabilities.map((c) => c.category))],
    }));

    // If all delegatorCounts are 0, enrich from live subgraph
    const allDelegatorZero = topOrchestrators.every((o) => o.delegatorCount === 0);
    const allVolumeZero = topOrchestrators.every((o) => o.totalVolumeETH === '0');
    if (allDelegatorZero || allVolumeZero) {
      try {
        const liveOrchs = await getOrchestrators();
        const liveMap = new Map(liveOrchs.map((o) => [o.address.toLowerCase(), o]));
        topOrchestrators = topOrchestrators.map((o) => {
          const live = liveMap.get(o.address.toLowerCase());
          if (!live) return o;
          return {
            ...o,
            delegatorCount: o.delegatorCount || live.delegatorCount,
            totalVolumeETH: o.totalVolumeETH === '0' ? live.totalVolumeETH : o.totalVolumeETH,
            thirtyDayVolumeETH: o.thirtyDayVolumeETH === '0' ? live.thirtyDayVolumeETH : o.thirtyDayVolumeETH,
            rewardCallRatio: o.rewardCallRatio || live.rewardCallRatio,
          };
        });
      } catch {
        // Live enrichment failed, serve DB data as-is
      }
    }

    res.json({
      data: {
        snapshots,
        topOrchestrators,
        prices: {
          lptUsd: prices.lptUsd,
          ethUsd: prices.ethUsd,
          lptChange24h: prices.lptChange24h,
        },
        current,
      },
    });
  } catch (err: any) {
    console.error('[networkOverview] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch network overview' });
  }
});

/**
 * Fee breakdown over time by capability category.
 * Joins TranscoderDay volumes with orchestrator capability data from DB.
 */
router.get('/api/v1/wallet/network/fees-by-capability', async (req: Request, res: Response) => {
  try {
    const days = parseInt((req.query.days as string) || '90');

    // Get capability map from DB
    const capabilities = await prisma.walletOrchestratorCapability.findMany({
      select: { address: true, category: true },
    });
    const capMap = new Map<string, string[]>();
    for (const c of capabilities) {
      if (!capMap.has(c.address)) capMap.set(c.address, []);
      const cats = capMap.get(c.address)!;
      if (!cats.includes(c.category)) cats.push(c.category);
    }

    // Fetch daily orchestrator fee data from the subgraph
    const { querySubgraph } = await import('../lib/livepeer.js');
    const data = await querySubgraph<{
      transcoderDays: Array<{
        date: number;
        volumeETH: string;
        transcoder: { id: string };
      }>;
    }>(`{
      transcoderDays(
        first: 1000
        orderBy: date
        orderDirection: desc
        where: { volumeETH_gt: "0" }
      ) {
        date
        volumeETH
        transcoder { id }
      }
    }`);

    // Group by date + capability
    const byDateCap = new Map<number, Record<string, number>>();
    const cutoffTs = Math.floor((Date.now() - days * 86400000) / 1000);

    for (const td of data.transcoderDays) {
      if (td.date < cutoffTs) continue;
      const addr = td.transcoder.id.toLowerCase();
      const vol = parseFloat(td.volumeETH);
      if (vol === 0) continue;

      const cats = capMap.get(addr) || ['transcoding'];

      if (!byDateCap.has(td.date)) byDateCap.set(td.date, {});
      const bucket = byDateCap.get(td.date)!;
      // Split volume equally across capabilities if orchestrator has multiple
      const share = vol / cats.length;
      for (const cat of cats) {
        bucket[cat] = (bucket[cat] || 0) + share;
      }
    }

    const series = [...byDateCap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([date, caps]) => ({ date: date * 1000, ...caps }));

    // Collect all categories seen
    const allCats = new Set<string>();
    for (const row of series) {
      for (const k of Object.keys(row)) {
        if (k !== 'date') allCats.add(k);
      }
    }

    res.json({ data: { series, categories: [...allCats] } });
  } catch (err: any) {
    console.error('[networkOverview] fees-by-capability error:', err.message);
    res.status(500).json({ error: 'Failed to fetch fee breakdown' });
  }
});

/**
 * Fee breakdown over time by gateway (broadcaster).
 * Uses BroadcasterDay entities from the subgraph.
 */
router.get('/api/v1/wallet/network/fees-by-gateway', async (req: Request, res: Response) => {
  try {
    const days = parseInt((req.query.days as string) || '90');
    const { querySubgraph } = await import('../lib/livepeer.js');

    // First get top gateways
    const topGateways = await querySubgraph<{
      broadcasters: Array<{ id: string; totalVolumeETH: string }>;
    }>(`{
      broadcasters(first: 10, orderBy: totalVolumeETH, orderDirection: desc) {
        id
        totalVolumeETH
      }
    }`);

    const gwIds = topGateways.broadcasters.map((b) => b.id);
    const gwLabels = new Map(topGateways.broadcasters.map((b) => [
      b.id,
      resolveGatewayName(b.id),
    ]));

    // Fetch daily volumes per gateway
    const gwFilter = gwIds.map((id) => `"${id}"`).join(',');
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

    const cutoffTs = Math.floor((Date.now() - days * 86400000) / 1000);
    const byDate = new Map<number, Record<string, number>>();

    for (const bd of bdData.broadcasterDays) {
      if (bd.date < cutoffTs) continue;
      const vol = parseFloat(bd.volumeETH);
      if (vol === 0) continue;
      const label = gwLabels.get(bd.broadcaster.id) || bd.broadcaster.id.slice(0, 10);

      if (!byDate.has(bd.date)) byDate.set(bd.date, {});
      const bucket = byDate.get(bd.date)!;
      bucket[label] = (bucket[label] || 0) + vol;
    }

    const series = [...byDate.entries()]
      .sort(([a], [b]) => a - b)
      .map(([date, gws]) => ({ date: date * 1000, ...gws }));

    const allGateways = [...new Set(
      bdData.broadcasterDays
        .filter((bd) => bd.date >= cutoffTs)
        .map((bd) => gwLabels.get(bd.broadcaster.id) || bd.broadcaster.id.slice(0, 10))
    )];

    // Gateway summary with total volumes
    const gatewaySummary = topGateways.broadcasters.map((b) => ({
      address: b.id,
      label: gwLabels.get(b.id)!,
      totalVolumeETH: b.totalVolumeETH,
    }));

    res.json({ data: { series, gateways: allGateways, gatewaySummary } });
  } catch (err: any) {
    console.error('[networkOverview] fees-by-gateway error:', err.message);
    res.status(500).json({ error: 'Failed to fetch gateway fees' });
  }
});

export default router;
