/**
 * Protocol resolver — The Graph subgraph backed.
 *
 * Requires:
 *   SUBGRAPH_API_KEY — The Graph API key
 *   SUBGRAPH_ID     — Subgraph ID (default: FE63YgkzcpVocxdCEyEYbvjYqEf2kb1A6daMYRxmejYC)
 *   L1_RPC_URL      — Optional, used for current block progress
 *
 * Source:
 *   The Graph subgraph → protocol round and staking data
 *   L1 RPC (viem mainnet) → current block number
 */

import type { DashboardProtocol } from '@naap/plugin-sdk';
import { createPublicClient, http } from 'viem';
import { mainnet } from 'viem/chains';
import { cachedFetch } from '../cache.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getSubgraphUrl(): string {
  const apiKey = process.env.SUBGRAPH_API_KEY;
  const subgraphId = process.env.SUBGRAPH_ID ?? 'FE63YgkzcpVocxdCEyEYbvjYqEf2kb1A6daMYRxmejYC';
  if (!apiKey) throw new Error('[facade/protocol] SUBGRAPH_API_KEY is not set');
  return `https://gateway.thegraph.com/api/${apiKey}/subgraphs/id/${subgraphId}`;
}

function toNumber(value: string | number | null | undefined): number {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

// ---------------------------------------------------------------------------
// Resolver
// ---------------------------------------------------------------------------

export async function resolveProtocol(): Promise<DashboardProtocol> {
  return cachedFetch('facade:protocol', 60 * 1000, async () => {
    const subgraphUrl = getSubgraphUrl();

    const query = /* GraphQL */ `
      query ProtocolOverview {
        protocol(id: "0") {
          roundLength
          totalActiveStake
          currentRound {
            id
            startBlock
            initialized
          }
        }
      }
    `;

    const res = await fetch(subgraphUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query }),
      signal: AbortSignal.timeout(60_000),
      next: { revalidate: 60 },
    });

    if (!res.ok) throw new Error(`[facade/protocol] subgraph HTTP ${res.status}`);

    type SubgraphProtocolResponse = {
      data?: {
        protocol?: {
          roundLength: string;
          totalActiveStake: string;
          currentRound: { id: string; startBlock: string; initialized: boolean } | null;
        } | null;
      };
      errors?: Array<{ message: string }>;
    };

    const body = (await res.json()) as SubgraphProtocolResponse;
    if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));

    const protocol = body.data?.protocol;
    if (!protocol?.currentRound) throw new Error('[facade/protocol] subgraph returned no currentRound data');

    const currentRound = Math.floor(toNumber(protocol.currentRound.id));
    const startBlock = Math.floor(toNumber(protocol.currentRound.startBlock));
    const initialized = Boolean(protocol.currentRound.initialized);
    const totalBlocks = Math.floor(toNumber(protocol.roundLength));
    const totalStakedLPT = toNumber(protocol.totalActiveStake);

    let currentBlock: number | null = null;
    try {
      const rpcUrl = process.env.L1_RPC_URL?.trim();
      if (rpcUrl) {
        const client = createPublicClient({
          chain: mainnet,
          transport: http(rpcUrl, { timeout: 60_000 }),
        });
        currentBlock = Number(await client.getBlockNumber());
      }
    } catch (err) {
      console.warn('[facade/protocol] L1 RPC unavailable:', err);
    }

    const rawProgress = initialized && currentBlock !== null ? currentBlock - startBlock : 0;
    const blockProgress = Math.max(0, Math.min(rawProgress, totalBlocks));

    return { currentRound, blockProgress, totalBlocks, totalStakedLPT };
  });
}
