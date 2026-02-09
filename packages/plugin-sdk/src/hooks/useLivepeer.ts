/**
 * Livepeer SDK Hooks (Phase 4f)
 *
 * High-level hooks for Livepeer integration in plugins.
 * These consume livepeer-svc via the shell API client.
 */

import { useQuery, useMutation } from './useQuery.js';
import { useShell } from './useShell.js';

// Path without /api prefix - the shell's API client adds it automatically
const LIVEPEER_API = '/v1/livepeer';

// ─── Types ──────────────────────────────────────────────────────────────────

interface Transcoder {
  address: string;
  serviceURI: string;
  active: boolean;
  delegatedStake: string;
  rewardCut: string;
  feeShare: string;
  pricePerPixel: string;
  status: string;
}

interface Delegator {
  bondedAmount: string;
  fees: string;
  delegateAddress: string;
  delegatedAmount: string;
  pendingStake: string;
  pendingFees: string;
  status: string;
}

interface SenderInfo {
  deposit: string;
  withdrawRound: string;
  reserve: {
    fundsRemaining: string;
    claimedInCurrentRound: string;
  };
}

interface ProtocolParameters {
  roundLength: number;
  currentRound: number;
  totalBonded: string;
  totalSupply: string;
  inflation: string;
  inflationChange: string;
  targetBondingRate: string;
  paused: boolean;
}

interface RoundInfo {
  number: number;
  initialized: boolean;
  startBlock: number;
}

interface LivepeerNode {
  id: string;
  name?: string;
  cliUrl: string;
  aiUrl?: string;
  mediaUrl?: string;
  role?: 'gateway' | 'orchestrator' | 'mixed';
}

interface LivepeerStatus {
  connected: boolean;
  error?: string;
  [key: string]: unknown;
}

interface GatewayPricingConfig {
  maxPricePerPixel?: string;
  maxPricePerCapability?: Record<string, string>;
}

interface LivepeerMetrics {
  requests: number;
  errors: number;
  avgLatencyMs: number;
  lastUpdated: string;
}

// ─── Hooks ──────────────────────────────────────────────────────────────────

/** Hook for orchestrator list from livepeer-svc. */
export function useOrchestrators() {
  const shell = useShell();
  return useQuery<Transcoder[]>(
    'livepeer:orchestrators',
    async () => {
      const res = await shell.api!.get<{ data: Transcoder[] }>(`${LIVEPEER_API}/orchestrators`);
      return res.data;
    },
    { staleTime: 60_000 }
  );
}

/** Hook for single orchestrator details. */
export function useOrchestrator(addr: string | null) {
  const shell = useShell();
  return useQuery<Transcoder>(
    `livepeer:orchestrator:${addr}`,
    async () => {
      if (!addr) throw new Error('No address');
      const res = await shell.api!.get<{ data: Transcoder }>(`${LIVEPEER_API}/orchestrators/${addr}`);
      return res.data;
    },
    { enabled: !!addr }
  );
}

/** Hook for current user's delegator info. */
export function useDelegator() {
  const shell = useShell();
  return useQuery<Delegator>(
    'livepeer:delegator',
    async () => {
      const res = await shell.api!.get<{ data: Delegator }>(`${LIVEPEER_API}/delegator`);
      return res.data;
    },
    { staleTime: 30_000 }
  );
}

/** Hook for staking actions (bond/unbond/claim). */
export function useStakingActions() {
  const shell = useShell();

  const bond = useMutation<unknown, { amount: string; toAddr: string }>(
    async (vars) => shell.api!.post(`${LIVEPEER_API}/staking/bond`, vars),
    { invalidateKeys: ['livepeer:delegator', 'livepeer:orchestrators'] }
  );

  const unbond = useMutation<unknown, { amount: string }>(
    async (vars) => shell.api!.post(`${LIVEPEER_API}/staking/unbond`, vars),
    { invalidateKeys: ['livepeer:delegator'] }
  );

  const claim = useMutation<unknown, void>(
    async () => shell.api!.post(`${LIVEPEER_API}/staking/claim`),
    { invalidateKeys: ['livepeer:delegator'] }
  );

  return { bond, unbond, claim };
}

/** Hook for gateway deposit/reserve info. */
export function useGatewayDeposit() {
  const shell = useShell();
  return useQuery<SenderInfo>(
    'livepeer:gateway:sender-info',
    async () => {
      const res = await shell.api!.get<{ data: SenderInfo }>(`${LIVEPEER_API}/gateway/sender-info`);
      return res.data;
    },
    { staleTime: 30_000 }
  );
}

/** Hook for gateway funding actions. */
export function useGatewayFunding() {
  const shell = useShell();
  const fund = useMutation<unknown, { deposit: string; reserve: string }>(
    async (vars) => shell.api!.post(`${LIVEPEER_API}/gateway/fund`, vars),
    { invalidateKeys: ['livepeer:gateway:sender-info'] }
  );

  const fundDeposit = useMutation<unknown, { amount: string }>(
    async (vars) => shell.api!.post(`${LIVEPEER_API}/gateway/fund-deposit`, vars),
    { invalidateKeys: ['livepeer:gateway:sender-info'] }
  );

  const unlock = useMutation<unknown, void>(
    async () => shell.api!.post(`${LIVEPEER_API}/gateway/unlock`),
    { invalidateKeys: ['livepeer:gateway:sender-info'] }
  );

  const cancelUnlock = useMutation<unknown, void>(
    async () => shell.api!.post(`${LIVEPEER_API}/gateway/cancel-unlock`),
    { invalidateKeys: ['livepeer:gateway:sender-info'] }
  );

  const withdraw = useMutation<unknown, void>(
    async () => shell.api!.post(`${LIVEPEER_API}/gateway/withdraw`),
    { invalidateKeys: ['livepeer:gateway:sender-info'] }
  );

  return { fund, fundDeposit, unlock, cancelUnlock, withdraw };
}

/** Hook for protocol parameters. */
export function useProtocolParameters() {
  const shell = useShell();
  return useQuery<ProtocolParameters>(
    'livepeer:protocol',
    async () => {
      const res = await shell.api!.get<{ data: ProtocolParameters }>(`${LIVEPEER_API}/protocol`);
      return res.data;
    },
    { staleTime: 120_000 }
  );
}

/** Hook for current round info. */
export function useCurrentRound() {
  const shell = useShell();
  return useQuery<RoundInfo>(
    'livepeer:round',
    async () => {
      const res = await shell.api!.get<{ data: RoundInfo }>(`${LIVEPEER_API}/rounds/current`);
      return res.data;
    },
    { staleTime: 60_000 }
  );
}

/** Hook for livepeer node status. */
export function useLivepeerNode() {
  const shell = useShell();
  return useQuery<LivepeerStatus>(
    'livepeer:status',
    async () => {
      const res = await shell.api!.get<{ data: LivepeerStatus }>(`${LIVEPEER_API}/status`);
      return res.data;
    },
    { staleTime: 15_000 }
  );
}

/** Hook for managed livepeer node list. */
export function useLivepeerNodes() {
  const shell = useShell();
  return useQuery<LivepeerNode[]>(
    'livepeer:nodes',
    async () => {
      const res = await shell.api!.get<{ data: LivepeerNode[] }>(`${LIVEPEER_API}/nodes`);
      return res.data;
    },
    { staleTime: 60_000 }
  );
}

/** Hook for gateway pricing configuration. */
export function useGatewayPricing() {
  const shell = useShell();
  return useQuery<GatewayPricingConfig>(
    'livepeer:gateway:pricing',
    async () => {
      const res = await shell.api!.get<{ data: GatewayPricingConfig }>(`${LIVEPEER_API}/gateway/pricing`);
      return res.data;
    },
    { staleTime: 30_000 }
  );
}

/** Hook for livepeer AI pipelines via livepeer-svc proxy. */
export function useLivepeerAI() {
  const shell = useShell();

  const capabilities = useQuery(
    'livepeer:ai:capabilities',
    async () => {
      const res = await shell.api!.get<{ data: Array<{ id: number; name: string; description?: string }> }>(
        `${LIVEPEER_API}/ai/capabilities`
      );
      return res.data;
    },
    { staleTime: 60_000 }
  );

  const execute = useMutation<unknown, { pipeline: string; input: Record<string, unknown> }>(
    async (vars) => {
      return shell.api!.post(`${LIVEPEER_API}/ai/${vars.pipeline}`, vars.input);
    }
  );

  return { capabilities, execute };
}

/** Hook for Live Video-to-Video sessions via livepeer-svc proxy. */
export function useLiveVideoToVideo(streamId?: string) {
  const shell = useShell();

  const start = useMutation<unknown, { stream: string; params: Record<string, unknown> }>(
    async (vars) => {
      return shell.api!.post(`${LIVEPEER_API}/ai/live/${vars.stream}/start`, vars.params);
    }
  );

  const update = useMutation<unknown, { stream: string; params: Record<string, unknown> }>(
    async (vars) => {
      return shell.api!.patch(`${LIVEPEER_API}/ai/live/${vars.stream}/update`, vars.params);
    }
  );

  const status = useQuery(
    streamId ? `livepeer:ai:live:${streamId}` : null,
    async () => {
      if (!streamId) return null;
      const res = await shell.api!.get(`${LIVEPEER_API}/ai/live/${streamId}/status`);
      return res;
    },
    { enabled: !!streamId, refetchInterval: 5000 }
  );

  return { start, update, status };
}

/** Hook for livepeer-svc metrics. */
export function useNetworkStats() {
  const shell = useShell();
  return useQuery<LivepeerMetrics>(
    'livepeer:metrics',
    async () => {
      const res = await shell.api!.get<{ data: LivepeerMetrics }>(`${LIVEPEER_API}/metrics`);
      return res.data;
    },
    { staleTime: 15_000 }
  );
}
