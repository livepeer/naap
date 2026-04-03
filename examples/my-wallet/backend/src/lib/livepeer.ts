/**
 * Livepeer on-chain data layer
 *
 * Layer 1: Subgraph (GraphQL) — orchestrators, protocol, delegator state, rounds
 * Layer 2: CoinGecko API — LPT/ETH prices + chart history
 *
 * Cached via @naap/cache (Redis-backed with in-memory fallback).
 */

import { cacheGetOrSet } from '@naap/cache';
import { parseUnits } from 'ethers';

// ---------------------------------------------------------------------------
// Utilities
// ---------------------------------------------------------------------------

function sanitizeAddress(addr: string): string {
  const cleaned = addr.toLowerCase().trim();
  if (!/^0x[a-f0-9]{40}$/.test(cleaned)) {
    throw new Error(`Invalid Ethereum address: ${addr.slice(0, 20)}`);
  }
  return cleaned;
}

/**
 * Safely convert a value to a BigInt-safe wei string.
 *
 * If the value is a pure integer string, it passes through unchanged
 * (assumed to already be in wei).  If it contains a decimal point,
 * it is treated as a human-readable value and multiplied by 1e18.
 */
export function toWei(val: string | undefined | null): string {
  if (!val || val === '0') return '0';
  try {
    if (/^-?\d+$/.test(val)) return val;
    return parseUnits(val, 18).toString();
  } catch {
    const dotIdx = val.indexOf('.');
    return dotIdx >= 0 ? (val.slice(0, dotIdx) || '0') : val;
  }
}

/**
 * Convert a subgraph decimal string (always in human-readable LPT/ETH
 * units, e.g. "2420.929..." or "1") to a wei string.
 * Unlike toWei, this ALWAYS applies the 1e18 multiplier because the
 * Livepeer subgraph uses BigDecimal for token amounts.
 */
function subgraphToWei(val: string | undefined | null): string {
  if (!val || val === '0') return '0';
  try {
    return parseUnits(val, 18).toString();
  } catch {
    const dotIdx = val.indexOf('.');
    if (dotIdx >= 0) {
      const intPart = val.slice(0, dotIdx) || '0';
      try { return parseUnits(intPart, 18).toString(); } catch { return '0'; }
    }
    return '0';
  }
}

/**
 * Derive a human-readable name from an orchestrator's serviceURI domain.
 * e.g. "https://vin-node.com:8935" → "Vin Node"
 *      "https://livepeer.flagshipnodes.com:8935" → "Flagship Nodes"
 *      "https://livepeer-orchestrator.prod.dcg-labs.co:8935" → "DCG Labs"
 */
export function deriveNameFromServiceURI(uri: string | null | undefined): string | null {
  if (!uri) return null;
  try {
    const url = new URL(uri);
    let host = url.hostname;

    // Skip raw IP addresses
    if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) return null;

    // Remove common prefixes
    host = host
      .replace(/^(www|livepeer|orch|orchestrator|node|lpt)[\.\-]/i, '')
      .replace(/^livepeer[\.\-]orchestrator[\.\-]/i, '')
      .replace(/^load[\.\-]balancer[\.\-]/i, '');

    // Extract the meaningful domain parts (skip TLD)
    const parts = host.split('.');
    let name = parts.length >= 2 ? parts[parts.length - 2] : parts[0];

    // For subdomains like "prod.dcg-labs.co", prefer the more meaningful part
    if (parts.length >= 3 && ['prod', 'staging', 'dev', 'app'].includes(parts[0])) {
      name = parts[1];
    }

    // Clean up: remove "livepeer" prefix/suffix if still present, and humanize
    name = name
      .replace(/^livepeer[\-_]?/i, '')
      .replace(/[\-_]?livepeer$/i, '')
      .replace(/[\-_]/g, ' ')
      .replace(/\b\w/g, c => c.toUpperCase())
      .trim();

    return name || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Subgraph
// ---------------------------------------------------------------------------

const SUBGRAPH_ID = 'FE63YgkzcpVocxdCEyEYbvjYqEf2kb1A6daMYRxmejYC';

let subgraphWarned = false;

export function getSubgraphUrls(): string[] {
  if (process.env.LIVEPEER_SUBGRAPH_URL) return [process.env.LIVEPEER_SUBGRAPH_URL];
  const key = process.env.SUBGRAPH_API_KEY || process.env.NEXT_PUBLIC_SUBGRAPH_API_KEY;
  if (key) {
    return [
      `https://gateway.thegraph.com/api/${key}/subgraphs/id/${SUBGRAPH_ID}`,
      `https://gateway-arbitrum.network.thegraph.com/api/${key}/subgraphs/id/${SUBGRAPH_ID}`,
    ];
  }
  if (!subgraphWarned) {
    console.warn('[livepeer] No SUBGRAPH_API_KEY configured — using free decentralized endpoint (rate-limited).');
    console.warn('[livepeer] For better performance, get a key at https://thegraph.com/studio/apikeys/');
    console.warn('[livepeer] Set SUBGRAPH_API_KEY in examples/my-wallet/backend/.env');
    subgraphWarned = true;
  }
  return [`https://gateway.thegraph.com/api/subgraphs/id/${SUBGRAPH_ID}`];
}

export async function querySubgraph<T = any>(query: string, variables?: Record<string, any>): Promise<T> {
  const urls = getSubgraphUrls();
  if (!urls.length) {
    throw new Error('No subgraph URL configured — set SUBGRAPH_API_KEY env var');
  }

  let lastErr: Error | null = null;
  for (const url of urls) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }),
      });
      if (!res.ok) {
        const text = await res.text();
        if (text.includes('auth error')) {
          throw new Error('Subgraph API key required. Set SUBGRAPH_API_KEY env var. Get a free key at https://thegraph.com/studio/apikeys/');
        }
        throw new Error(`Subgraph ${res.status}: ${text}`);
      }
      const json = await res.json();
      if (json.errors?.length) throw new Error(json.errors[0].message);
      return json.data as T;
    } catch (err) {
      lastErr = err as Error;
    }
  }
  throw lastErr || new Error('All subgraph endpoints failed');
}

// ---------------------------------------------------------------------------
// Arbitrum RPC for contract reads (fallback when subgraph unavailable)
// ---------------------------------------------------------------------------

const ARBITRUM_RPC = process.env.ARBITRUM_RPC_URL || 'https://arb1.arbitrum.io/rpc';

async function ethCall(to: string, data: string, retries = 5): Promise<string> {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(ARBITRUM_RPC, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'eth_call',
          params: [{ to, data }, 'latest'],
        }),
      });
      if (res.status === 429) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      const json = await res.json();
      if (json.error) {
        if ((json.error.message?.includes('Too Many') || json.error.message?.includes('rate limit')) && attempt < retries - 1) {
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        throw new Error(json.error.message);
      }
      return json.result;
    } catch (err: any) {
      if (attempt < retries - 1 && (err.message?.includes('fetch') || err.message?.includes('ECONNRESET'))) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      throw err;
    }
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
// Transaction receipt (for gas accounting)
// ---------------------------------------------------------------------------

export interface TransactionReceiptResult {
  gasUsed: string;
  effectiveGasPrice: string;
  status: string;
  blockNumber: string;
}

export async function getTransactionReceipt(txHash: string): Promise<TransactionReceiptResult | null> {
  try {
    const res = await fetch(ARBITRUM_RPC, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_getTransactionReceipt',
        params: [txHash],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = await res.json();
    return json.result || null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Cache helper — delegates to @naap/cache (Redis + in-memory fallback)
// ---------------------------------------------------------------------------

function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  return cacheGetOrSet(key, fn, { ttl: Math.round(ttlMs / 1000), prefix: 'wallet' });
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
        roundLength: parseInt(String(p.roundLength || '5760')),
        lockPeriod: parseInt(String(p.lockPeriod || '7')),
        totalActiveStake: String(p.totalActiveStake || '0'),
        totalSupply: String(p.totalSupply || '0'),
        participationRate: parseFloat(String(p.participationRate || '0')) * 100,
        inflation: String(p.inflation || '0'),
        inflationChange: String(p.inflationChange || '0'),
        activeTranscoderCount: parseInt(String(p.activeTranscoderCount || '0')),
        delegatorsCount: parseInt(String(p.delegatorsCount || '0')),
        lptPriceEth: String(p.lptPriceEth || '0'),
        totalVolumeETH: String(p.totalVolumeETH || '0'),
        totalVolumeUSD: String(p.totalVolumeUSD || '0'),
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
  activationRound: number;
  deactivationRound: number;
  totalRewardTokens: string;
  // Computed
  rewardCallRatio: number; // 0-1 based on last 90 pools
}

export function getOrchestrators(): Promise<OrchestratorData[]> {
  return cached('orchestrators', 60 * 60_000, async () => { try {
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
        activationRound: string;
        deactivationRound: string;
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
        activationRound
        deactivationRound
        lastRewardRound { id }
        delegators(first: 1000) { id }
        pools(first: 90, orderBy: id, orderDirection: desc) { rewardTokens }
      }
    }`);

    return data.transcoders.map(t => {
      const poolsWithReward = t.pools.filter(p => parseFloat(p.rewardTokens) > 0).length;
      const callRatio = t.pools.length > 0 ? poolsWithReward / t.pools.length : 0;
      const totalRewardTokens = t.pools.reduce(
        (sum, p) => sum + BigInt(Math.floor(parseFloat(p.rewardTokens || '0') * 1e18)),
        0n,
      );

      return {
        address: t.id,
        active: t.active,
        totalStake: t.totalStake,
        rewardCut: parseInt(t.rewardCut) / 10000,
        feeShare: parseInt(t.feeShare) / 10000,
        thirtyDayVolumeETH: t.thirtyDayVolumeETH,
        sixtyDayVolumeETH: t.sixtyDayVolumeETH,
        ninetyDayVolumeETH: t.ninetyDayVolumeETH,
        totalVolumeETH: t.totalVolumeETH,
        delegatorCount: t.delegators.length,
        lastRewardRound: t.lastRewardRound?.id || '0',
        serviceURI: t.serviceURI,
        activationRound: parseInt(t.activationRound || '0'),
        deactivationRound: Math.min(parseInt(t.deactivationRound || '0'), 2_000_000_000),
        totalRewardTokens: totalRewardTokens.toString(),
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

  const addressSet = new Set<string>();
  const addresses: string[] = [firstAddr];
  addressSet.add(firstAddr.toLowerCase());
  let current = firstAddr;
  for (let i = 0; i < 150; i++) { // safety limit
    const calldata = SELECTORS.getNextTranscoderInPool + padAddress(current).slice(2);
    const nextResult = await ethCall(BM, calldata);
    const nextAddr = decodeAddressAt(nextResult, 0);
    if (!nextAddr || nextAddr === '0x' + '0'.repeat(40) || nextAddr === firstAddr) break;
    // Skip duplicates
    if (addressSet.has(nextAddr.toLowerCase())) break;
    addressSet.add(nextAddr.toLowerCase());
    addresses.push(nextAddr);
    current = nextAddr;
    // Delay every 5 calls to avoid rate limiting
    if (i % 5 === 4) await new Promise(r => setTimeout(r, 500));
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
          activationRound: 0,
          deactivationRound: 0,
          totalRewardTokens: '0',
          rewardCallRatio: 0,
        };
      })
    );
    orchestrators.push(...results);
    // Delay between batches to avoid rate limiting
    if (i + BATCH_SIZE < addresses.length) await new Promise(r => setTimeout(r, 500));
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
  const safe = sanitizeAddress(addr);
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
    delegator(id: "${safe}") {
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
    bondedAmount: subgraphToWei(d.bondedAmount),
    principal: subgraphToWei(d.principal),
    fees: subgraphToWei(d.fees),
    delegateAddress: d.delegate?.id || null,
    startRound: d.startRound || '0',
    lastClaimRound: d.lastClaimRound || '0',
    unbondingLocks: (d.unbondingLocks || []).map(l => ({
      id: l.unbondingLockId,
      amount: subgraphToWei(l.amount),
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
// Staking History (events for a delegator)
// ---------------------------------------------------------------------------

export interface StakingEvent {
  type: 'bond' | 'unbond' | 'rebond' | 'reward' | 'withdrawFees' | 'withdrawStake';
  timestamp: number;
  round: number;
  amount: string;        // LPT wei for staking, ETH wei for fees
  orchestrator: string | null;
  txHash: string | null;
}

export async function getStakingHistory(address: string): Promise<StakingEvent[]> {
  const addr = address.toLowerCase();
  return cached(`staking-history-${addr}`, 5 * 60_000, async () => {
    // Try subgraph first
    try {
      return await getStakingHistoryFromSubgraph(addr);
    } catch {
      console.warn('Subgraph unavailable for staking history, using state-derived fallback');
      return getStakingHistoryFromState(addr);
    }
  });
}

async function getStakingHistoryFromSubgraph(addr: string): Promise<StakingEvent[]> {
  const safe = sanitizeAddress(addr);
  const data = await querySubgraph<{
    bondEvents: Array<{ timestamp: string; round: { id: string }; additionalAmount: string; newDelegate: { id: string }; transaction: { id: string } }>;
    unbondEvents: Array<{ timestamp: string; round: { id: string }; amount: string; delegate: { id: string }; transaction: { id: string } }>;
    rebondEvents: Array<{ timestamp: string; round: { id: string }; amount: string; delegate: { id: string }; transaction: { id: string } }>;
    earningsClaimedEvents: Array<{ timestamp: string; round: { id: string }; rewardTokens: string; fees: string; delegate: { id: string }; transaction: { id: string } }>;
    withdrawStakeEvents: Array<{ timestamp: string; round: { id: string }; amount: string; transaction: { id: string } }>;
    withdrawFeesEvents: Array<{ timestamp: string; round: { id: string }; amount: string; transaction: { id: string } }>;
  }>(`{
    bondEvents(first: 50, where: { delegator: "${safe}" }, orderBy: timestamp, orderDirection: desc) {
      timestamp round { id } additionalAmount newDelegate { id } transaction { id }
    }
    unbondEvents(first: 50, where: { delegator: "${safe}" }, orderBy: timestamp, orderDirection: desc) {
      timestamp round { id } amount delegate { id } transaction { id }
    }
    rebondEvents(first: 50, where: { delegator: "${safe}" }, orderBy: timestamp, orderDirection: desc) {
      timestamp round { id } amount delegate { id } transaction { id }
    }
    earningsClaimedEvents: earningsClaimedEvents(first: 50, where: { delegator: "${safe}" }, orderBy: timestamp, orderDirection: desc) {
      timestamp round { id } rewardTokens fees delegate { id } transaction { id }
    }
    withdrawStakeEvents(first: 20, where: { delegator: "${safe}" }, orderBy: timestamp, orderDirection: desc) {
      timestamp round { id } amount transaction { id }
    }
    withdrawFeesEvents: withdrawFeesEvents(first: 20, where: { delegator: "${safe}" }, orderBy: timestamp, orderDirection: desc) {
      timestamp round { id } amount transaction { id }
    }
  }`);

  const events: StakingEvent[] = [];

  for (const e of (data.bondEvents || [])) {
    events.push({
      type: 'bond',
      timestamp: parseInt(e.timestamp),
      round: parseInt(e.round?.id || '0'),
      amount: e.additionalAmount,
      orchestrator: e.newDelegate?.id || null,
      txHash: e.transaction?.id || null,
    });
  }

  for (const e of (data.unbondEvents || [])) {
    events.push({
      type: 'unbond',
      timestamp: parseInt(e.timestamp),
      round: parseInt(e.round?.id || '0'),
      amount: e.amount,
      orchestrator: e.delegate?.id || null,
      txHash: e.transaction?.id || null,
    });
  }

  for (const e of (data.rebondEvents || [])) {
    events.push({
      type: 'rebond',
      timestamp: parseInt(e.timestamp),
      round: parseInt(e.round?.id || '0'),
      amount: e.amount,
      orchestrator: e.delegate?.id || null,
      txHash: e.transaction?.id || null,
    });
  }

  for (const e of (data.earningsClaimedEvents || [])) {
    if (e.rewardTokens && e.rewardTokens !== '0') {
      events.push({
        type: 'reward',
        timestamp: parseInt(e.timestamp),
        round: parseInt(e.round?.id || '0'),
        amount: e.rewardTokens,
        orchestrator: e.delegate?.id || null,
        txHash: e.transaction?.id || null,
      });
    }
    if (e.fees && e.fees !== '0') {
      events.push({
        type: 'withdrawFees',
        timestamp: parseInt(e.timestamp),
        round: parseInt(e.round?.id || '0'),
        amount: e.fees,
        orchestrator: e.delegate?.id || null,
        txHash: e.transaction?.id || null,
      });
    }
  }

  for (const e of (data.withdrawStakeEvents || [])) {
    events.push({
      type: 'withdrawStake',
      timestamp: parseInt(e.timestamp),
      round: parseInt(e.round?.id || '0'),
      amount: e.amount,
      orchestrator: null,
      txHash: e.transaction?.id || null,
    });
  }

  for (const e of (data.withdrawFeesEvents || [])) {
    events.push({
      type: 'withdrawFees',
      timestamp: parseInt(e.timestamp),
      round: parseInt(e.round?.id || '0'),
      amount: e.amount,
      orchestrator: null,
      txHash: e.transaction?.id || null,
    });
  }

  // Sort by timestamp desc
  events.sort((a, b) => b.timestamp - a.timestamp);
  return events;
}

async function getStakingHistoryFromState(addr: string): Promise<StakingEvent[]> {
  // Build minimal history from current delegator state
  const delegator = await getDelegator(addr);
  if (!delegator) return [];

  const protocol = await getProtocol();
  const events: StakingEvent[] = [];
  const now = Math.floor(Date.now() / 1000);

  // Current delegation as a "bond" event
  if (delegator.bondedAmount && delegator.bondedAmount !== '0') {
    events.push({
      type: 'bond',
      timestamp: now,
      round: protocol.currentRound,
      amount: delegator.principal || delegator.bondedAmount,
      orchestrator: delegator.delegateAddress,
      txHash: null,
    });

    // Accumulated rewards (difference between bonded and principal)
    const bonded = BigInt(toWei(delegator.bondedAmount));
    const principal = BigInt(toWei(delegator.principal));
    if (principal > 0n && bonded > principal) {
      events.push({
        type: 'reward',
        timestamp: now,
        round: protocol.currentRound,
        amount: (bonded - principal).toString(),
        orchestrator: delegator.delegateAddress,
        txHash: null,
      });
    }
  }

  // Pending fees
  if (delegator.fees && delegator.fees !== '0') {
    events.push({
      type: 'withdrawFees',
      timestamp: now,
      round: protocol.currentRound,
      amount: delegator.fees,
      orchestrator: delegator.delegateAddress,
      txHash: null,
    });
  }

  // Unbonding locks
  for (const lock of delegator.unbondingLocks || []) {
    events.push({
      type: 'unbond',
      timestamp: now,
      round: parseInt(lock.withdrawRound),
      amount: lock.amount,
      orchestrator: lock.delegateAddress || null,
      txHash: null,
    });
  }

  return events;
}

// ---------------------------------------------------------------------------
// Daily Reward Rate Estimation
// ---------------------------------------------------------------------------

export interface DailyRewardEstimate {
  dailyRewardLpt: number;
  method: 'observed' | 'estimated';
  apr: number;
}

/**
 * Estimate daily reward for a delegator.
 * Uses observed rate when accumulated rewards are available,
 * otherwise estimates from network inflation and orchestrator pool data.
 * Accepts pre-fetched delegator/protocol to avoid duplicate RPC calls.
 */
export async function estimateDailyReward(
  address: string,
  prefetchedDelegator?: DelegatorData | null,
  prefetchedProtocol?: ProtocolData,
): Promise<DailyRewardEstimate> {
  const addr = address.toLowerCase();
  const delegator = prefetchedDelegator !== undefined ? prefetchedDelegator : await getDelegator(addr);
  if (!delegator || delegator.bondedAmount === '0') {
    return { dailyRewardLpt: 0, method: 'estimated', apr: 0 };
  }

  const protocol = prefetchedProtocol || await getProtocol();
  const totalStaked = parseFloat(delegator.bondedAmount) / 1e18;
  const principal = parseFloat(delegator.principal || '0') / 1e18;
  const accumulated = totalStaked - principal;
  const currentRound = protocol.currentRound;
  const lastClaimRound = parseInt(delegator.lastClaimRound || '0');
  const roundsElapsed = currentRound - lastClaimRound;

  // Always try inflation-based estimate (Method 2) first — it gives the
  // current forward-looking daily rate accounting for reward cut.
  // Method 1 (observed) is only reliable for recent claim windows.
  let inflationEstimate: DailyRewardEstimate | null = null;
  try {
    const orchAddr = delegator.delegateAddress;
    if (orchAddr) {
      const [totalBondedHex, orchPoolStakeHex, orchDataHex] = await Promise.all([
        ethCall(CONTRACTS.BondingManager, SELECTORS.getTotalBonded),
        ethCall(CONTRACTS.BondingManager, SELECTORS.transcoderTotalStake + padAddress(orchAddr).slice(2)),
        ethCall(CONTRACTS.BondingManager, SELECTORS.getTranscoder + padAddress(orchAddr).slice(2)),
      ]);

      const totalBonded = Number(decodeUint256(totalBondedHex)) / 1e18;
      const orchPoolStake = Number(decodeUint256(orchPoolStakeHex)) / 1e18;
      const rewardCut = Number(decodeUint256At(orchDataHex, 1)) / 10000; // percentage

      if (totalBonded > 0 && orchPoolStake > 0) {
        // Livepeer daily inflation rate (~0.097% per round/day based on observed data)
        const dailyInflationRate = 0.00097;
        const poolDailyReward = orchPoolStake * dailyInflationRate;

        const isSelfDelegated = orchAddr.toLowerCase() === addr;
        const orchCommission = poolDailyReward * (rewardCut / 100);
        const delegatorPoolReward = poolDailyReward - orchCommission;
        const userShare = totalStaked / orchPoolStake;
        let dailyReward = delegatorPoolReward * userShare;

        // Self-delegated orchestrators also receive the orchestrator commission
        if (isSelfDelegated) {
          dailyReward += orchCommission;
        }

        const apr = totalStaked > 0 ? (dailyReward * 365 / totalStaked) * 100 : 0;
        inflationEstimate = { dailyRewardLpt: dailyReward, method: 'estimated', apr };
      }
    }
  } catch (err) {
    console.warn('Failed to compute inflation-based reward estimate:', err);
  }

  // Method 1: Observed rate — only use when lastClaimRound is known (non-zero)
  // and the window is recent (< 90 rounds) so the rate reflects current conditions.
  if (accumulated > 0 && roundsElapsed > 0 && lastClaimRound > 0 && roundsElapsed < 90) {
    const dailyRate = accumulated / roundsElapsed;
    const apr = principal > 0 ? (accumulated / principal) * (365 / roundsElapsed) * 100 : 0;
    return { dailyRewardLpt: dailyRate, method: 'observed', apr };
  }

  // Return inflation estimate if available
  if (inflationEstimate) return inflationEstimate;

  // Last resort: lifetime average (only if we have no better option)
  if (accumulated > 0 && roundsElapsed > 0) {
    const dailyRate = accumulated / roundsElapsed;
    const apr = principal > 0 ? (accumulated / principal) * (365 / roundsElapsed) * 100 : 0;
    return { dailyRewardLpt: dailyRate, method: 'observed', apr };
  }

  return { dailyRewardLpt: 0, method: 'estimated', apr: 0 };
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
    if (!res.ok) {
      console.warn(`CoinGecko ${res.status}, returning cached/default prices`);
      return {
        lptUsd: 0, ethUsd: 0, lptChange24h: 0, lptChange7d: 0,
        ethChange24h: 0, lptMarketCap: 0, lptVolume24h: 0, fetchedAt: new Date().toISOString(),
      } as PriceInfo;
    }
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
