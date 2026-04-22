/**
 * Shared Livepeer subgraph + price utilities for wallet route handlers.
 */

import {
  fetchEthUsdFromPublicExchanges,
  fetchLptUsd24hChangePercent,
  fetchLptUsdDailyCloseChart,
  fetchLptUsdFromPublicExchanges,
} from '@/lib/prices/public-exchange-spot';

const SUBGRAPH_ID = 'FE63YgkzcpVocxdCEyEYbvjYqEf2kb1A6daMYRxmejYC';

function getSubgraphUrls(): string[] {
  const key = process.env.SUBGRAPH_API_KEY;
  if (key) {
    return [
      `https://gateway.thegraph.com/api/${key}/subgraphs/id/${SUBGRAPH_ID}`,
      `https://gateway-arbitrum.network.thegraph.com/api/${key}/subgraphs/id/${SUBGRAPH_ID}`,
    ];
  }
  return [`https://gateway.thegraph.com/api/subgraphs/id/${SUBGRAPH_ID}`];
}

export async function querySubgraph<T = any>(query: string): Promise<T> {
  const urls = getSubgraphUrls();
  let lastErr: Error | null = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query }),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`Subgraph ${res.status}`);
      const json = await res.json();
      if (json.errors?.length) throw new Error(json.errors[0].message);
      return json.data as T;
    } catch (err) {
      lastErr = err as Error;
    }
  }
  throw lastErr || new Error('Subgraph query failed');
}

export async function getOrchestrators() {
  const protocol = await getProtocol();
  const round = protocol.currentRound;
  const data = await querySubgraph<{ transcoders: any[] }>(`{
    transcoders(
      first: 100
      where: { activationRound_lte: ${round}, deactivationRound_gt: ${round} }
      orderBy: thirtyDayVolumeETH
      orderDirection: desc
    ) {
      id active totalStake rewardCut feeShare
      thirtyDayVolumeETH sixtyDayVolumeETH ninetyDayVolumeETH totalVolumeETH
      serviceURI activationRound deactivationRound
      lastRewardRound { id }
      delegators(first: 1000) { id }
      pools(first: 90, orderBy: id, orderDirection: desc) { rewardTokens }
    }
  }`);

  return (data.transcoders || []).map((t: any) => {
    const pools = t.pools || [];
    const poolsWithReward = pools.filter((p: any) => parseFloat(p.rewardTokens) > 0).length;
    const callRatio = pools.length > 0 ? poolsWithReward / pools.length : 0;
    const totalRewardTokens = pools.reduce(
      (sum: bigint, p: any) => sum + BigInt(Math.floor(parseFloat(p.rewardTokens || '0') * 1e18)),
      0n,
    );

    return {
      address: t.id,
      rewardCut: parseInt(t.rewardCut) / 10000,
      feeShare: parseInt(t.feeShare) / 10000,
      totalStake: t.totalStake || '0',
      isActive: true,
      lastRewardRound: t.lastRewardRound?.id || '0',
      delegatorCount: (t.delegators || []).length,
      totalVolumeETH: t.totalVolumeETH || '0',
      thirtyDayVolumeETH: t.thirtyDayVolumeETH || '0',
      ninetyDayVolumeETH: t.ninetyDayVolumeETH || '0',
      totalRewardTokens: totalRewardTokens.toString(),
      rewardCallRatio: callRatio,
      name: null,
    };
  });
}

export async function getProtocol() {
  const data = await querySubgraph<{ protocol: any }>(`{
    protocol(id: "0") {
      totalSupply totalActiveStake participationRate inflation inflationChange
      currentRound { id length }
      activeTranscoderCount delegatorsCount
      totalVolumeETH totalVolumeUSD paused
    }
  }`);
  const p = data.protocol || {};
  return {
    totalSupply: p.totalSupply || '0',
    totalActiveStake: p.totalActiveStake || '0',
    participationRate: parseFloat(p.participationRate || '0') * 100,
    inflation: p.inflation || '0',
    inflationChange: p.inflationChange || '0',
    currentRound: parseInt(p.currentRound?.id || '0'),
    roundLength: parseInt(p.currentRound?.length || '0'),
    activeTranscoderCount: parseInt(String(p.activeTranscoderCount || '0')),
    delegatorsCount: parseInt(String(p.delegatorsCount || '0')),
    totalVolumeETH: p.totalVolumeETH || '0',
    totalVolumeUSD: p.totalVolumeUSD || '0',
    paused: p.paused || false,
    lastUpdated: new Date().toISOString(),
  };
}

export async function getPrices() {
  try {
    const [lptUsdRaw, ethUsdRaw, chg] = await Promise.all([
      fetchLptUsdFromPublicExchanges(),
      fetchEthUsdFromPublicExchanges(),
      fetchLptUsd24hChangePercent(),
    ]);
    return {
      lptUsd: lptUsdRaw != null && Number.isFinite(lptUsdRaw) && lptUsdRaw > 0 ? lptUsdRaw : 0,
      ethUsd: ethUsdRaw != null && Number.isFinite(ethUsdRaw) && ethUsdRaw > 0 ? ethUsdRaw : 0,
      lptChange24h: chg != null && Number.isFinite(chg) ? chg : 0,
    };
  } catch {
    return { lptUsd: 0, ethUsd: 0, lptChange24h: 0 };
  }
}

export async function getPriceChart(days: number) {
  try {
    const pts = await fetchLptUsdDailyCloseChart(days);
    return pts.map((p) => ({ timestamp: p.timestamp, price: p.price }));
  } catch {
    return [];
  }
}

export async function getWinningTicketEvents(limit: number) {
  const data = await querySubgraph<{ winningTicketRedeemedEvents: any[] }>(`{
    winningTicketRedeemedEvents(first: ${limit}, orderBy: timestamp, orderDirection: desc) {
      id timestamp round { id }
      sender { id } recipient { id }
      faceValue
      transaction { id }
    }
  }`);
  return (data.winningTicketRedeemedEvents || []).map((e: any) => ({
    id: e.id,
    timestamp: parseInt(e.timestamp) * 1000,
    round: parseInt(e.round?.id || '0'),
    sender: e.sender?.id || '',
    recipient: e.recipient?.id || '',
    faceValue: e.faceValue || '0',
    txHash: e.transaction?.id || '',
  }));
}

export async function getStakingHistory(address: string) {
  const data = await querySubgraph<{ bondEvents: any[]; unbondEvents: any[]; rebondEvents: any[] }>(`{
    bondEvents(first: 100, orderBy: timestamp, orderDirection: desc, where: { delegator: "${address}" }) {
      id timestamp bondedAmount additionalAmount delegator { id } newDelegate { id } oldDelegate { id }
      transaction { id }
    }
    unbondEvents(first: 100, orderBy: timestamp, orderDirection: desc, where: { delegator: "${address}" }) {
      id timestamp amount withdrawRound delegator { id } delegate { id }
      transaction { id }
    }
    rebondEvents(first: 100, orderBy: timestamp, orderDirection: desc, where: { delegator: "${address}" }) {
      id timestamp amount delegator { id } delegate { id }
      transaction { id }
    }
  }`);
  const events: any[] = [];
  for (const e of data.bondEvents || []) {
    events.push({ type: 'bond', timestamp: parseInt(e.timestamp) * 1000, amount: e.additionalAmount || e.bondedAmount, delegate: e.newDelegate?.id, txHash: e.transaction?.id });
  }
  for (const e of data.unbondEvents || []) {
    events.push({ type: 'unbond', timestamp: parseInt(e.timestamp) * 1000, amount: e.amount, delegate: e.delegate?.id, withdrawRound: e.withdrawRound, txHash: e.transaction?.id });
  }
  for (const e of data.rebondEvents || []) {
    events.push({ type: 'rebond', timestamp: parseInt(e.timestamp) * 1000, amount: e.amount, delegate: e.delegate?.id, txHash: e.transaction?.id });
  }
  return events.sort((a, b) => b.timestamp - a.timestamp);
}

export async function getPolls() {
  const data = await querySubgraph<{
    polls: Array<{
      id: string;
      proposal: string;
      endBlock: string;
      quorum: string;
      quota: string;
      tally: { yes: string; no: string } | null;
    }>;
  }>(`{
    polls(first: 20, orderBy: endBlock, orderDirection: desc) {
      id proposal endBlock quorum quota
      tally { yes no }
    }
  }`);
  return data.polls || [];
}

export async function getNetworkDays(count = 30) {
  const data = await querySubgraph<{
    days: Array<{
      date: number;
      volumeETH: string;
      volumeUSD: string;
      participationRate: string;
      inflation: string;
      activeTranscoderCount: string | number;
      delegatorsCount: string | number;
    }>;
  }>(`{
    days(first: ${count}, orderBy: date, orderDirection: desc) {
      date volumeETH volumeUSD participationRate inflation
      activeTranscoderCount delegatorsCount
    }
  }`);
  return data.days || [];
}
