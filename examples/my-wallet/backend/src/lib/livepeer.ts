/**
 * Livepeer on-chain data layer
 *
 * Layer 1: Subgraph (GraphQL) — orchestrators, protocol, delegator state, rounds
 * Layer 2: CoinGecko API — LPT/ETH prices + chart history
 *
 * All data is cached in-memory with configurable TTL.
 */

// ---------------------------------------------------------------------------
// Subgraph
// ---------------------------------------------------------------------------

const SUBGRAPH_ID = 'FE63YgkzcpVocxdCEyEYbvjYqEf2kb1A6daMYRxmejYC';

function getSubgraphUrl(): string {
  if (process.env.LIVEPEER_SUBGRAPH_URL) return process.env.LIVEPEER_SUBGRAPH_URL;
  const key = process.env.SUBGRAPH_API_KEY || process.env.NEXT_PUBLIC_SUBGRAPH_API_KEY;
  if (key) return `https://gateway.thegraph.com/api/${key}/subgraphs/id/${SUBGRAPH_ID}`;
  // The Graph requires an API key. Get a free one at https://thegraph.com/studio/apikeys/
  // For now, use the Livepeer explorer's proxy which is publicly accessible
  return `https://gateway.thegraph.com/api/subgraphs/id/${SUBGRAPH_ID}`;
}

export async function querySubgraph<T = any>(query: string, variables?: Record<string, any>): Promise<T> {
  const url = getSubgraphUrl();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  // Add API key as bearer token if using gateway
  const key = process.env.SUBGRAPH_API_KEY || process.env.NEXT_PUBLIC_SUBGRAPH_API_KEY;
  if (key && url.includes('gateway.thegraph.com')) {
    headers['Authorization'] = `Bearer ${key}`;
  }
  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    const text = await res.text();
    // If auth error, provide helpful message
    if (text.includes('auth error')) {
      throw new Error('Subgraph API key required. Set SUBGRAPH_API_KEY env var. Get a free key at https://thegraph.com/studio/apikeys/');
    }
    throw new Error(`Subgraph ${res.status}: ${text}`);
  }
  const json = await res.json();
  if (json.errors?.length) throw new Error(json.errors[0].message);
  return json.data as T;
}

// ---------------------------------------------------------------------------
// Arbitrum RPC for contract reads (fallback when subgraph unavailable)
// ---------------------------------------------------------------------------

const ARBITRUM_RPC = process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc';

async function ethCall(to: string, data: string, retries = 3): Promise<string> {
  for (let attempt = 0; attempt < retries; attempt++) {
    const res = await fetch(ARBITRUM_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: 1, method: 'eth_call',
        params: [{ to, data }, 'latest'],
      }),
    });
    if (res.status === 429) {
      // Rate limited — wait and retry
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    const json = await res.json();
    if (json.error) {
      if (json.error.message?.includes('Too Many') && attempt < retries - 1) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      throw new Error(json.error.message);
    }
    return json.result;
  }
  throw new Error('ethCall: max retries exceeded');
}

function encodeSelector(sig: string): string {
  // Simple keccak256 for function selector — we'll hardcode the selectors we need
  return sig; // We use pre-computed selectors below
}

// Pre-computed function selectors
const SELECTORS = {
  currentRound: '0x8a19c8bc',           // RoundsManager.currentRound()
  currentRoundStartBlock: '0x823a3c0c', // RoundsManager.currentRoundStartBlock()
  roundLength: '0x8b649b94',            // RoundsManager.roundLength()
  getTotalBonded: '0x5c50c356',         // BondingManager.getTotalBonded()
  getTranscoderPoolSize: '0x2a4e0d55',  // BondingManager.getTranscoderPoolSize()
  getDelegator: '0xa64ad595',           // BondingManager.getDelegator(address)
  getTranscoder: '0x5dce9948',          // BondingManager.getTranscoder(address)
  pendingStake: '0x9d0b2c7a',           // BondingManager.pendingStake(address,uint256)
  pendingFees: '0xf595f1cc',            // BondingManager.pendingFees(address,uint256)
  transcoderTotalStake: '0x9ef9df94',   // BondingManager.transcoderTotalStake(address)
  getFirstTranscoderInPool: '0x88a6c749', // BondingManager.getFirstTranscoderInPool()
  getNextTranscoderInPool: '0x235c9603',  // BondingManager.getNextTranscoderInPool(address)
  totalSupply: '0x18160ddd',            // LPT.totalSupply()
  balanceOf: '0x70a08231',              // LPT.balanceOf(address)
} as const;

function padAddress(addr: string): string {
  return '0x' + addr.replace('0x', '').toLowerCase().padStart(64, '0');
}

function padUint256(n: number | bigint): string {
  return '0x' + BigInt(n).toString(16).padStart(64, '0');
}

function decodeUint256(hex: string): bigint {
  if (!hex || hex === '0x') return 0n;
  return BigInt(hex.slice(0, 66)); // first 32 bytes
}

function decodeUint256At(hex: string, slot: number): bigint {
  const start = 2 + slot * 64;
  const chunk = '0x' + hex.slice(start, start + 64);
  return BigInt(chunk || '0x0');
}

function decodeAddressAt(hex: string, slot: number): string {
  const start = 2 + slot * 64;
  const chunk = hex.slice(start, start + 64);
  return '0x' + chunk.slice(24);
}

// ---------------------------------------------------------------------------
// Simple in-memory cache
// ---------------------------------------------------------------------------

const cache = new Map<string, { data: any; expiresAt: number }>();

function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const entry = cache.get(key);
  if (entry && Date.now() < entry.expiresAt) return Promise.resolve(entry.data as T);
  return fn().then(data => {
    cache.set(key, { data, expiresAt: Date.now() + ttlMs });
    return data;
  });
}

// ---------------------------------------------------------------------------
// Contract addresses (Arbitrum One)
// ---------------------------------------------------------------------------

export const CONTRACTS = {
  LivepeerToken: '0x289ba1701C2F088cf0faf8B3705246331cB8A839',
  BondingManager: '0x35Bcf3c30594191d53231E4FF333E8A770453e40',
  RoundsManager: '0xdd6f56DcC28D3F5f27084381fE8Df634985cc39f',
  Controller: '0xD8E8328501E9645d16Cf49539efC04f734606ee4',
  TicketBroker: '0xa8bB618B1520E284046F3dFc448851A1Ff26e41B',
  ServiceRegistry: '0xC92d3A360b8f9e083bA64DE15d95Cf8180897431',
} as const;

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------

export interface ProtocolData {
  currentRound: number;
  roundLength: number;
  lockPeriod: number;
  totalActiveStake: string;
  totalSupply: string;
  participationRate: number;
  inflation: string;
  inflationChange: string;
  activeTranscoderCount: number;
  delegatorsCount: number;
  lptPriceEth: string;
  totalVolumeETH: string;
  totalVolumeUSD: string;
  paused: boolean;
  lastUpdated: string;
}

export function getProtocol(): Promise<ProtocolData> {
  return cached('protocol', 2 * 60_000, async () => {
    // Try subgraph first, fall back to RPC
    try {
      const data = await querySubgraph<{
        protocol: {
          currentRound: { id: string };
          roundLength: string;
          lockPeriod: string;
          totalActiveStake: string;
          totalSupply: string;
          participationRate: string;
          inflation: string;
          inflationChange: string;
          activeTranscoderCount: number;
          delegatorsCount: number;
          lptPriceEth: string;
          totalVolumeETH: string;
          totalVolumeUSD: string;
          paused: boolean;
        };
      }>(`{
        protocol(id: "0") {
          currentRound { id }
          roundLength
          lockPeriod
          totalActiveStake
          totalSupply
          participationRate
          inflation
          inflationChange
          activeTranscoderCount
          delegatorsCount
          lptPriceEth
          totalVolumeETH
          totalVolumeUSD
          paused
        }
      }`);

      const p = data.protocol;
      return {
        currentRound: parseInt(p.currentRound?.id || '0'),
        roundLength: parseInt(p.roundLength || '5760'),
        lockPeriod: parseInt(p.lockPeriod || '7'),
        totalActiveStake: p.totalActiveStake || '0',
        totalSupply: p.totalSupply || '0',
        participationRate: parseFloat(p.participationRate || '0'),
        inflation: p.inflation || '0',
        inflationChange: p.inflationChange || '0',
        activeTranscoderCount: p.activeTranscoderCount || 0,
        delegatorsCount: p.delegatorsCount || 0,
        lptPriceEth: p.lptPriceEth || '0',
        totalVolumeETH: p.totalVolumeETH || '0',
        totalVolumeUSD: p.totalVolumeUSD || '0',
        paused: p.paused || false,
        lastUpdated: new Date().toISOString(),
      };
    } catch (subgraphErr) {
      console.warn('Subgraph unavailable, using RPC fallback:', (subgraphErr as Error).message);
      return getProtocolFromRPC();
    }
  });
}

async function getProtocolFromRPC(): Promise<ProtocolData> {
  const [roundHex, totalBondedHex, totalSupplyHex, poolSizeHex, roundLengthHex] = await Promise.all([
    ethCall(CONTRACTS.RoundsManager, SELECTORS.currentRound),
    ethCall(CONTRACTS.BondingManager, SELECTORS.getTotalBonded),
    ethCall(CONTRACTS.LivepeerToken, SELECTORS.totalSupply),
    ethCall(CONTRACTS.BondingManager, SELECTORS.getTranscoderPoolSize),
    ethCall(CONTRACTS.RoundsManager, SELECTORS.roundLength),
  ]);

  const currentRound = Number(decodeUint256(roundHex));
  const totalBonded = decodeUint256(totalBondedHex);
  const totalSupply = decodeUint256(totalSupplyHex);
  const poolSize = Number(decodeUint256(poolSizeHex));
  const roundLength = Number(decodeUint256(roundLengthHex));

  const participationRate = totalSupply > 0n
    ? Number((totalBonded * 10000n) / totalSupply) / 100
    : 0;

  return {
    currentRound,
    roundLength,
    lockPeriod: 7,
    totalActiveStake: totalBonded.toString(),
    totalSupply: totalSupply.toString(),
    participationRate,
    inflation: '0',
    inflationChange: '0',
    activeTranscoderCount: poolSize,
    delegatorsCount: 0,
    lptPriceEth: '0',
    totalVolumeETH: '0',
    totalVolumeUSD: '0',
    paused: false,
    lastUpdated: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Orchestrators
// ---------------------------------------------------------------------------

export interface OrchestratorData {
  address: string;
  active: boolean;
  totalStake: string;
  rewardCut: number;       // 0-100 percentage
  feeShare: number;        // 0-100 percentage
  thirtyDayVolumeETH: string;
  sixtyDayVolumeETH: string;
  ninetyDayVolumeETH: string;
  totalVolumeETH: string;
  delegatorCount: number;
  lastRewardRound: string;
  serviceURI: string | null;
  // Computed
  rewardCallRatio: number; // 0-1 based on last 90 pools
}

export function getOrchestrators(): Promise<OrchestratorData[]> {
  return cached('orchestrators', 3 * 60_000, async () => { try {
    const protocol = await getProtocol();
    const round = protocol.currentRound;

    const data = await querySubgraph<{
      transcoders: Array<{
        id: string;
        active: boolean;
        totalStake: string;
        rewardCut: string;
        feeShare: string;
        thirtyDayVolumeETH: string;
        sixtyDayVolumeETH: string;
        ninetyDayVolumeETH: string;
        totalVolumeETH: string;
        serviceURI: string | null;
        lastRewardRound: { id: string } | null;
        delegators: { id: string }[];
        pools: { rewardTokens: string }[];
      }>;
    }>(`{
      transcoders(
        first: 100
        where: { activationRound_lte: ${round}, deactivationRound_gt: ${round} }
        orderBy: thirtyDayVolumeETH
        orderDirection: desc
      ) {
        id
        active
        totalStake
        rewardCut
        feeShare
        thirtyDayVolumeETH
        sixtyDayVolumeETH
        ninetyDayVolumeETH
        totalVolumeETH
        serviceURI
        lastRewardRound { id }
        delegators(first: 1000) { id }
        pools(first: 90, orderBy: id, orderDirection: desc) { rewardTokens }
      }
    }`);

    return data.transcoders.map(t => {
      const poolsWithReward = t.pools.filter(p => parseFloat(p.rewardTokens) > 0).length;
      const callRatio = t.pools.length > 0 ? poolsWithReward / t.pools.length : 0;

      return {
        address: t.id,
        active: t.active,
        totalStake: t.totalStake,
        rewardCut: parseInt(t.rewardCut) / 10000,    // basis points (1M = 100%) → percentage
        feeShare: parseInt(t.feeShare) / 10000,
        thirtyDayVolumeETH: t.thirtyDayVolumeETH,
        sixtyDayVolumeETH: t.sixtyDayVolumeETH,
        ninetyDayVolumeETH: t.ninetyDayVolumeETH,
        totalVolumeETH: t.totalVolumeETH,
        delegatorCount: t.delegators.length,
        lastRewardRound: t.lastRewardRound?.id || '0',
        serviceURI: t.serviceURI,
        rewardCallRatio: callRatio,
      };
    });
  } catch (err) {
    console.warn('Subgraph unavailable for orchestrators, using RPC fallback');
    return getOrchestratorsFromRPC();
  }
  });
}

async function getOrchestratorsFromRPC(): Promise<OrchestratorData[]> {
  const BM = CONTRACTS.BondingManager;

  // Walk the active transcoder pool sequentially: first → next → next → ...
  const firstResult = await ethCall(BM, SELECTORS.getFirstTranscoderInPool);
  const firstAddr = decodeAddressAt(firstResult, 0);
  if (!firstAddr || firstAddr === '0x' + '0'.repeat(40)) return [];

  const addresses: string[] = [firstAddr];
  let current = firstAddr;
  for (let i = 0; i < 150; i++) { // safety limit
    const calldata = SELECTORS.getNextTranscoderInPool + padAddress(current).slice(2);
    const nextResult = await ethCall(BM, calldata);
    const nextAddr = decodeAddressAt(nextResult, 0);
    if (!nextAddr || nextAddr === '0x' + '0'.repeat(40) || nextAddr === firstAddr) break;
    addresses.push(nextAddr);
    current = nextAddr;
    // Small delay every 10 calls to avoid rate limiting
    if (i % 10 === 9) await new Promise(r => setTimeout(r, 200));
  }

  // Batch fetch details in groups of 5 to avoid rate limiting
  const BATCH_SIZE = 5;
  const orchestrators: OrchestratorData[] = [];

  for (let i = 0; i < addresses.length; i += BATCH_SIZE) {
    const batch = addresses.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(
      batch.map(async (addr) => {
        const [transcoderResult, stakeResult] = await Promise.all([
          ethCall(BM, SELECTORS.getTranscoder + padAddress(addr).slice(2)),
          ethCall(BM, SELECTORS.transcoderTotalStake + padAddress(addr).slice(2)),
        ]);

        const lastRewardRound = decodeUint256At(transcoderResult, 0);
        const rewardCut = decodeUint256At(transcoderResult, 1);
        const feeShare = decodeUint256At(transcoderResult, 2);
        const totalStake = decodeUint256(stakeResult);

        return {
          address: addr,
          active: true,
          totalStake: totalStake.toString(),
          rewardCut: Number(rewardCut) / 10000,
          feeShare: Number(feeShare) / 10000,
          thirtyDayVolumeETH: '0',
          sixtyDayVolumeETH: '0',
          ninetyDayVolumeETH: '0',
          totalVolumeETH: '0',
          delegatorCount: 0,
          lastRewardRound: lastRewardRound.toString(),
          serviceURI: null,
          rewardCallRatio: 0,
        };
      })
    );
    orchestrators.push(...results);
    // Delay between batches
    if (i + BATCH_SIZE < addresses.length) await new Promise(r => setTimeout(r, 300));
  }

  // Sort by totalStake descending
  orchestrators.sort((a, b) => {
    const sa = BigInt(a.totalStake);
    const sb = BigInt(b.totalStake);
    return sb > sa ? 1 : sb < sa ? -1 : 0;
  });

  return orchestrators;
}

// ---------------------------------------------------------------------------
// Delegator (account-level)
// ---------------------------------------------------------------------------

export interface DelegatorData {
  bondedAmount: string;
  principal: string;
  fees: string;
  delegateAddress: string | null;
  startRound: string;
  lastClaimRound: string;
  unbondingLocks: Array<{
    id: string;
    amount: string;
    withdrawRound: string;
    delegateAddress: string;
  }>;
  delegateInfo: {
    active: boolean;
    totalStake: string;
    rewardCut: number;
    feeShare: number;
  } | null;
}

export async function getDelegator(address: string): Promise<DelegatorData | null> {
  const addr = address.toLowerCase();
  // Try subgraph first, fall back to RPC
  try {
    return await getDelegatorFromSubgraph(addr);
  } catch {
    console.warn('Subgraph unavailable for delegator, using RPC fallback');
    return getDelegatorFromRPC(addr);
  }
}

async function getDelegatorFromRPC(address: string): Promise<DelegatorData | null> {
  try {
    const protocol = await getProtocol();
    const calldata = SELECTORS.getDelegator + padAddress(address).slice(2);
    const result = await ethCall(CONTRACTS.BondingManager, calldata);

    if (!result || result === '0x') return null;

    const bondedAmount = decodeUint256At(result, 0);
    const fees = decodeUint256At(result, 1);
    const delegateAddress = decodeAddressAt(result, 2);
    const delegatedAmount = decodeUint256At(result, 3);
    const startRound = decodeUint256At(result, 4);
    const lastClaimRound = decodeUint256At(result, 5);

    if (bondedAmount === 0n && delegateAddress === '0x0000000000000000000000000000000000000000') {
      return null;
    }

    // Get pending stake
    const pendingCalldata = SELECTORS.pendingStake + padAddress(address).slice(2) + padUint256(protocol.currentRound).slice(2);
    let pendingStake = bondedAmount;
    try {
      const pendingResult = await ethCall(CONTRACTS.BondingManager, pendingCalldata);
      pendingStake = decodeUint256(pendingResult);
    } catch {}

    return {
      bondedAmount: pendingStake.toString(),
      principal: bondedAmount.toString(),
      fees: fees.toString(),
      delegateAddress: delegateAddress === '0x0000000000000000000000000000000000000000' ? null : delegateAddress,
      startRound: startRound.toString(),
      lastClaimRound: lastClaimRound.toString(),
      unbondingLocks: [],
      delegateInfo: null,
    };
  } catch (err) {
    console.error('RPC getDelegator failed:', err);
    return null;
  }
}

async function getDelegatorFromSubgraph(addr: string): Promise<DelegatorData | null> {
  const data = await querySubgraph<{
    delegator: {
      bondedAmount: string;
      principal: string;
      fees: string;
      delegate: { id: string; active: boolean; totalStake: string; rewardCut: string; feeShare: string } | null;
      startRound: string;
      lastClaimRound: string;
      unbondingLocks: Array<{
        unbondingLockId: string;
        amount: string;
        withdrawRound: string;
        delegate: { id: string };
      }>;
    } | null;
  }>(`{
    delegator(id: "${addr}") {
      bondedAmount
      principal
      fees
      delegate { id active totalStake rewardCut feeShare }
      startRound
      lastClaimRound
      unbondingLocks(where: { amount_gt: "0" }) {
        unbondingLockId
        amount
        withdrawRound
        delegate { id }
      }
    }
  }`);

  if (!data.delegator) return null;
  const d = data.delegator;

  return {
    bondedAmount: d.bondedAmount || '0',
    principal: d.principal || '0',
    fees: d.fees || '0',
    delegateAddress: d.delegate?.id || null,
    startRound: d.startRound || '0',
    lastClaimRound: d.lastClaimRound || '0',
    unbondingLocks: (d.unbondingLocks || []).map(l => ({
      id: l.unbondingLockId,
      amount: l.amount,
      withdrawRound: l.withdrawRound,
      delegateAddress: l.delegate?.id || '',
    })),
    delegateInfo: d.delegate ? {
      active: d.delegate.active,
      totalStake: d.delegate.totalStake,
      rewardCut: parseInt(d.delegate.rewardCut) / 10000,
      feeShare: parseInt(d.delegate.feeShare) / 10000,
    } : null,
  };
}

// ---------------------------------------------------------------------------
// Network History (Days entity)
// ---------------------------------------------------------------------------

export interface DayData {
  date: number;
  volumeETH: string;
  volumeUSD: string;
  participationRate: string;
  inflation: string;
  activeTranscoderCount: number;
  delegatorsCount: number;
}

export function getNetworkDays(count = 30): Promise<DayData[]> {
  return cached(`days-${count}`, 15 * 60_000, async () => {
    try {
      const data = await querySubgraph<{
        days: DayData[];
      }>(`{
        days(first: ${count}, orderBy: date, orderDirection: desc) {
          date
          volumeETH
          volumeUSD
          participationRate
          inflation
          activeTranscoderCount
          delegatorsCount
        }
      }`);
      return data.days || [];
    } catch (err) {
      console.warn('Subgraph unavailable for network days');
      return [];
    }
  });
}

// ---------------------------------------------------------------------------
// Governance (Polls + Treasury)
// ---------------------------------------------------------------------------

export interface PollData {
  id: string;
  proposal: string;
  endBlock: string;
  quorum: string;
  quota: string;
  tally: { yes: string; no: string } | null;
}

export function getPolls(): Promise<PollData[]> {
  return cached('polls', 5 * 60_000, async () => {
    try {
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
          id
          proposal
          endBlock
          quorum
          quota
          tally { yes no }
        }
      }`);
      return data.polls || [];
    } catch (err) {
      console.warn('Subgraph unavailable for polls');
      return [];
    }
  });
}

// ---------------------------------------------------------------------------
// Prices (CoinGecko)
// ---------------------------------------------------------------------------

const CG_BASE = 'https://api.coingecko.com/api/v3';

function cgHeaders(): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/json' };
  const key = process.env.COINGECKO_API_KEY;
  if (key) h['x-cg-demo-api-key'] = key;
  return h;
}

export interface PriceInfo {
  lptUsd: number;
  ethUsd: number;
  lptChange24h: number;
  lptChange7d: number;
  ethChange24h: number;
  lptMarketCap: number;
  lptVolume24h: number;
  fetchedAt: string;
}

export function getPrices(): Promise<PriceInfo> {
  return cached('prices', 3 * 60_000, async () => {
    const res = await fetch(
      `${CG_BASE}/simple/price?ids=livepeer,ethereum&vs_currencies=usd&include_24hr_change=true&include_7d_change=true&include_market_cap=true&include_24hr_vol=true`,
      { headers: cgHeaders() },
    );
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const data = await res.json();
    return {
      lptUsd: data.livepeer?.usd ?? 0,
      ethUsd: data.ethereum?.usd ?? 0,
      lptChange24h: data.livepeer?.usd_24h_change ?? 0,
      lptChange7d: data.livepeer?.usd_7d_change ?? 0,
      ethChange24h: data.ethereum?.usd_24h_change ?? 0,
      lptMarketCap: data.livepeer?.usd_market_cap ?? 0,
      lptVolume24h: data.livepeer?.usd_24h_vol ?? 0,
      fetchedAt: new Date().toISOString(),
    };
  });
}

export interface PriceChartPoint {
  timestamp: number;
  price: number;
}

export function getPriceChart(days: number = 30): Promise<PriceChartPoint[]> {
  return cached(`price-chart-${days}`, 15 * 60_000, async () => {
    const res = await fetch(
      `${CG_BASE}/coins/livepeer/market_chart?vs_currency=usd&days=${days}`,
      { headers: cgHeaders() },
    );
    if (!res.ok) throw new Error(`CoinGecko chart ${res.status}`);
    const data = await res.json();
    return (data.prices || []).map(([ts, price]: [number, number]) => ({ timestamp: ts, price }));
  });
}
