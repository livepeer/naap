/**
 * Dashboard Data Provider
 *
 * Registers as the dashboard data provider using createDashboardProvider()
 * from the SDK. Serves mock data for most widget types.
 *
 * Protocol and fees resolvers fetch live data from the Livepeer subgraph
 * and L1 RPC via server-side proxy routes. Other resolvers still use mock data.
 */

import {
  createDashboardProvider,
  type IEventBus,
  type DashboardProtocol,
} from '@naap/plugin-sdk';
import {
  mockKPI,
  mockPipelines,
  mockGPU,
  mockPricing,
} from './data/index.js';
import { fetchSubgraphFees, fetchSubgraphProtocol } from './api/subgraph.js';

async function fetchCurrentProtocolBlock(): Promise<number> {
  const response = await fetch('/api/v1/protocol-block');
  if (!response.ok) {
    throw new Error(`protocol-block HTTP ${response.status}`);
  }

  const body = (await response.json()) as { blockNumber?: number };
  if (!Number.isFinite(body.blockNumber)) {
    throw new Error('protocol-block returned invalid blockNumber');
  }

  return Number(body.blockNumber);
}

async function resolveProtocol(): Promise<DashboardProtocol> {
  const [protocol, currentProtocolBlock] = await Promise.all([
    fetchSubgraphProtocol(),
    fetchCurrentProtocolBlock(),
  ]);

  const rawProgress = protocol.initialized
    ? currentProtocolBlock - protocol.startBlock
    : 0;
  const blockProgress = Math.max(0, Math.min(rawProgress, protocol.totalBlocks));

  return {
    currentRound: protocol.currentRound,
    blockProgress,
    totalBlocks: protocol.totalBlocks,
    totalStakedLPT: protocol.totalStakedLPT,
  };
}

async function resolveFees({ days }: { days?: number }) {
  return fetchSubgraphFees(days);
}

/**
 * Register the dashboard data provider on the event bus.
 *
 * @param eventBus - The shell event bus instance
 * @returns Cleanup function to call on plugin unmount
 */
export function registerDashboardProvider(eventBus: IEventBus): () => void {
  return createDashboardProvider(eventBus, {
    kpi: async () => mockKPI,
    protocol: () => resolveProtocol(),
    fees: ({ days }: { days?: number }) => resolveFees({ days }),
    pipelines: async () => mockPipelines,
    gpuCapacity: async () => mockGPU,
    pricing: async () => mockPricing,
  });
}
