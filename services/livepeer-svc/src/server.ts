/**
 * Livepeer Service (livepeer-svc)
 *
 * NaaP backend service that:
 * - Manages connections to go-livepeer nodes (gateway + orchestrator)
 * - Proxies CLI API calls (localhost-only on real nodes) to NaaP frontend
 * - Adds NaaP auth layer (JWT validation)
 * - Caches expensive queries (orchestrators, protocol parameters)
 * - Provides aggregated data from multiple nodes
 * - Falls back to mock data when real nodes are unavailable (for development)
 */

import { createPluginServer } from '@naap/plugin-server-sdk';
import { LivepeerCliClient, LivepeerAIClient } from '@naap/livepeer-node-client';
import type { Transcoder, ProtocolParameters, Delegator, SenderInfo } from '@naap/livepeer-node-client';
import { cacheGetOrSet } from '@naap/cache';
import type { CacheOptions } from '@naap/cache';

const LIVEPEER_CLI_URL = process.env.LIVEPEER_CLI_URL || 'http://localhost:7935';
const LIVEPEER_AI_URL = process.env.LIVEPEER_AI_URL || 'http://localhost:9935';
const CACHE_TTL = 60_000; // 1 minute

// Enable mock data fallback when real nodes are unavailable
// Set to 'false' in production to get real errors instead of mock data
const USE_MOCK_FALLBACK = process.env.LIVEPEER_MOCK_FALLBACK !== 'false';

const cacheOptions: CacheOptions = { ttl: CACHE_TTL / 1000, prefix: 'livepeer' };

// ─── Mock Data (for development when no go-livepeer node is running) ─────────

const MOCK_ORCHESTRATORS: Transcoder[] = [
  {
    address: '0x847791cBF03be716A7fe9Dc8c9Affe17Bd49Ae5e',
    serviceURI: 'https://orchestrator-1.livepeer.network',
    active: true,
    delegatedStake: '125000000000000000000000',
    rewardCut: '10000',
    feeShare: '500000',
    pricePerPixel: '1200',
    status: 'Registered',
  },
  {
    address: '0x9C10672CEE058Fd658103d90872fE431bb6C0AFa',
    serviceURI: 'https://orchestrator-2.livepeer.network',
    active: true,
    delegatedStake: '98000000000000000000000',
    rewardCut: '15000',
    feeShare: '450000',
    pricePerPixel: '1000',
    status: 'Registered',
  },
  {
    address: '0x4f4758F7167B18e1F5B3c1a7575E3eb584894dbc',
    serviceURI: 'https://orchestrator-3.livepeer.network',
    active: true,
    delegatedStake: '75000000000000000000000',
    rewardCut: '5000',
    feeShare: '600000',
    pricePerPixel: '800',
    status: 'Registered',
  },
  {
    address: '0xBD677e96a755207D348578727AA57A512C2022Bd',
    serviceURI: 'https://orchestrator-4.livepeer.network',
    active: false,
    delegatedStake: '50000000000000000000000',
    rewardCut: '20000',
    feeShare: '400000',
    pricePerPixel: '1500',
    status: 'Registered',
  },
  {
    address: '0x525419FF5707190389bfb5C87c375D710F5fCb0E',
    serviceURI: 'https://orchestrator-5.livepeer.network',
    active: true,
    delegatedStake: '200000000000000000000000',
    rewardCut: '8000',
    feeShare: '550000',
    pricePerPixel: '900',
    status: 'Registered',
  },
];

const MOCK_DELEGATOR: Delegator = {
  bondedAmount: '10000000000000000000000',
  fees: '500000000000000000',
  delegateAddress: '0x847791cBF03be716A7fe9Dc8c9Affe17Bd49Ae5e',
  delegatedAmount: '10000000000000000000000',
  pendingStake: '0',
  pendingFees: '250000000000000000',
  status: 'Bonded',
};

const MOCK_SENDER_INFO: SenderInfo = {
  deposit: '5000000000000000000',
  withdrawRound: '0',
  reserve: {
    fundsRemaining: '2500000000000000000',
    claimedInCurrentRound: '100000000000000000',
  },
};

const MOCK_PROTOCOL: ProtocolParameters = {
  roundLength: 5760,
  currentRound: 3245,
  totalBonded: '15000000000000000000000000',
  totalSupply: '30000000000000000000000000',
  inflation: '1500',
  inflationChange: '3',
  targetBondingRate: '500000',
  paused: false,
};

const MOCK_ROUND = {
  number: 3245,
  initialized: true,
  startBlock: 18650000,
};

const MOCK_CAPABILITIES = [
  { id: 1, name: 'text-to-image', description: 'Generate images from text prompts' },
  { id: 2, name: 'image-to-image', description: 'Transform images with AI' },
  { id: 3, name: 'image-to-video', description: 'Animate images into videos' },
  { id: 4, name: 'upscale', description: 'Upscale images to higher resolution' },
  { id: 5, name: 'segment-anything-2', description: 'Segment objects in images/videos' },
  { id: 6, name: 'llm', description: 'Large language model inference' },
  { id: 7, name: 'audio-to-text', description: 'Transcribe audio to text' },
  { id: 8, name: 'live-video-to-video', description: 'Real-time video transformation' },
];

const MOCK_STATUS = {
  connected: true,
  version: '0.7.5-mock',
  network: 'arbitrum-mainnet',
  ethAddress: '0x1234567890123456789012345678901234567890',
  orchestratorMode: false,
  broadcasterMode: true,
  transcoder: false,
  mock: true,
};

// ─── Livepeer Clients + Node Registry ───────────────────────────────────────

interface LivepeerNode {
  id: string;
  name?: string;
  cliUrl: string;
  aiUrl?: string;
  mediaUrl?: string;
  role?: 'gateway' | 'orchestrator' | 'mixed';
}

const nodes = new Map<string, LivepeerNode>();

function registerNode(node: LivepeerNode): void {
  nodes.set(node.id, node);
}

function isAllowedLoopbackUrl(url: string | undefined): boolean {
  if (!url) return true;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return false;
  }
  // Restrict to loopback hosts to prevent SSRF to arbitrary hosts.
  const hostname = parsed.hostname.replace(/\.$/, '');
  const allowedHosts = new Set(['localhost', '127.0.0.1', '::1']);
  return allowedHosts.has(hostname);
}

registerNode({
  id: 'default',
  name: 'default-node',
  cliUrl: LIVEPEER_CLI_URL,
  aiUrl: LIVEPEER_AI_URL,
  role: 'mixed',
});

const cliClients = new Map<string, LivepeerCliClient>();
const aiClients = new Map<string, LivepeerAIClient>();

function getCliClient(nodeId?: string): LivepeerCliClient {
  const id = nodeId && nodes.has(nodeId) ? nodeId : 'default';
  if (!cliClients.has(id)) {
    const node = nodes.get(id)!;
    cliClients.set(id, new LivepeerCliClient(node.cliUrl));
  }
  return cliClients.get(id)!;
}

function getAiClient(nodeId?: string): LivepeerAIClient {
  const id = nodeId && nodes.has(nodeId) ? nodeId : 'default';
  if (!aiClients.has(id)) {
    const node = nodes.get(id)!;
    aiClients.set(id, new LivepeerAIClient(node.aiUrl || LIVEPEER_AI_URL));
  }
  return aiClients.get(id)!;
}

// ─── Metrics ────────────────────────────────────────────────────────────────

const metrics = {
  requests: 0,
  errors: 0,
  totalLatencyMs: 0,
  lastUpdated: new Date().toISOString(),
};

function recordMetric(latencyMs: number, isError: boolean): void {
  metrics.requests += 1;
  metrics.totalLatencyMs += latencyMs;
  if (isError) metrics.errors += 1;
  metrics.lastUpdated = new Date().toISOString();
}

// ─── Server ─────────────────────────────────────────────────────────────────

const { router, start } = createPluginServer({
  name: 'livepeer-svc',
  port: parseInt(process.env.PORT || '4010', 10),
  publicRoutes: ['/healthz', '/api/v1/livepeer/status'],
});

// ─── Request Metrics Middleware ──────────────────────────────────────────────

router.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const latency = Date.now() - start;
    recordMetric(latency, res.statusCode >= 400);
  });
  next();
});

// ─── Routes ─────────────────────────────────────────────────────────────────

// Status
router.get('/livepeer/status', async (req, res) => {
  const cliClient = getCliClient(req.query.nodeId as string | undefined);
  try {
    const status = await cliClient.getStatus();
    res.json({ success: true, data: status });
  } catch (err) {
    if (USE_MOCK_FALLBACK) {
      res.json({ success: true, data: MOCK_STATUS, mock: true });
    } else {
      res.json({
        success: true,
        data: { connected: false, error: 'Unable to connect to go-livepeer node' },
      });
    }
  }
});

// Orchestrators (cached)
router.get('/livepeer/orchestrators', async (_req, res) => {
  try {
    const orchestrators = await cacheGetOrSet(
      'orchestrators',
      async () => {
        const cliClient = getCliClient();
        return cliClient.getRegisteredOrchestrators();
      },
      cacheOptions
    );
    res.json({ success: true, data: orchestrators, cached: true });
  } catch (err) {
    if (USE_MOCK_FALLBACK) {
      res.json({ success: true, data: MOCK_ORCHESTRATORS, mock: true });
    } else {
      res.status(503).json({
        success: false,
        error: { code: 'NODE_UNAVAILABLE', message: 'Cannot reach go-livepeer node' },
      });
    }
  }
});

// Single orchestrator
router.get('/livepeer/orchestrators/:addr', async (req, res) => {
  try {
    const orchestrators = await cacheGetOrSet(
      'orchestrators',
      async () => {
        const cliClient = getCliClient();
        return cliClient.getRegisteredOrchestrators();
      },
      cacheOptions
    );
    const orc = orchestrators.find(o => o.address.toLowerCase() === req.params.addr.toLowerCase());
    if (!orc) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Orchestrator not found' } });
    }
    res.json({ success: true, data: orc });
  } catch (err) {
    if (USE_MOCK_FALLBACK) {
      const orc = MOCK_ORCHESTRATORS.find(o => o.address.toLowerCase() === req.params.addr.toLowerCase());
      if (!orc) {
        return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Orchestrator not found' } });
      }
      res.json({ success: true, data: orc, mock: true });
    } else {
      res.status(503).json({ success: false, error: { code: 'NODE_UNAVAILABLE', message: 'Cannot reach go-livepeer node' } });
    }
  }
});

// Delegator info
router.get('/livepeer/delegator', async (_req, res) => {
  try {
    const cliClient = getCliClient();
    const delegator = await cliClient.getDelegatorInfo();
    res.json({ success: true, data: delegator });
  } catch (err) {
    if (USE_MOCK_FALLBACK) {
      res.json({ success: true, data: MOCK_DELEGATOR, mock: true });
    } else {
      res.status(503).json({ success: false, error: { code: 'NODE_UNAVAILABLE', message: 'Cannot reach go-livepeer node' } });
    }
  }
});

// Staking operations
router.post('/livepeer/staking/bond', async (req, res) => {
  try {
    const { amount, toAddr } = req.body;
    const cliClient = getCliClient();
    const result = await cliClient.bond(amount, toAddr);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'TX_FAILED', message: String(err) } });
  }
});

router.post('/livepeer/staking/unbond', async (req, res) => {
  try {
    const cliClient = getCliClient();
    const result = await cliClient.unbond(req.body.amount);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'TX_FAILED', message: String(err) } });
  }
});

router.post('/livepeer/staking/claim', async (_req, res) => {
  try {
    const cliClient = getCliClient();
    const result = await cliClient.claimEarnings();
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'TX_FAILED', message: String(err) } });
  }
});

// Gateway deposit/reserve
router.get('/livepeer/gateway/sender-info', async (_req, res) => {
  try {
    const cliClient = getCliClient();
    const info = await cliClient.getSenderInfo();
    res.json({ success: true, data: info });
  } catch (err) {
    if (USE_MOCK_FALLBACK) {
      res.json({ success: true, data: MOCK_SENDER_INFO, mock: true });
    } else {
      res.status(503).json({ success: false, error: { code: 'NODE_UNAVAILABLE', message: 'Cannot reach go-livepeer node' } });
    }
  }
});

router.post('/livepeer/gateway/fund', async (req, res) => {
  try {
    const { deposit, reserve } = req.body;
    const cliClient = getCliClient();
    const result = await cliClient.fundDepositAndReserve(deposit, reserve);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'TX_FAILED', message: String(err) } });
  }
});

router.post('/livepeer/gateway/fund-deposit', async (req, res) => {
  try {
    const { amount } = req.body;
    const cliClient = getCliClient();
    const result = await cliClient.fundDeposit(amount);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'TX_FAILED', message: String(err) } });
  }
});

router.post('/livepeer/gateway/unlock', async (_req, res) => {
  try {
    const cliClient = getCliClient();
    const result = await cliClient.unlock();
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'TX_FAILED', message: String(err) } });
  }
});

router.post('/livepeer/gateway/cancel-unlock', async (_req, res) => {
  try {
    const cliClient = getCliClient();
    const result = await cliClient.cancelUnlock();
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'TX_FAILED', message: String(err) } });
  }
});

router.post('/livepeer/gateway/withdraw', async (_req, res) => {
  try {
    const cliClient = getCliClient();
    const result = await cliClient.withdraw();
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'TX_FAILED', message: String(err) } });
  }
});

// Protocol parameters (cached)
router.get('/livepeer/protocol', async (_req, res) => {
  try {
    const params = await cacheGetOrSet(
      'protocol',
      async () => {
        const cliClient = getCliClient();
        return cliClient.getProtocolParameters();
      },
      cacheOptions
    );
    res.json({ success: true, data: params, cached: true });
  } catch (err) {
    if (USE_MOCK_FALLBACK) {
      res.json({ success: true, data: MOCK_PROTOCOL, mock: true });
    } else {
      res.status(503).json({ success: false, error: { code: 'NODE_UNAVAILABLE', message: 'Cannot reach go-livepeer node' } });
    }
  }
});

// Current round
router.get('/livepeer/rounds/current', async (_req, res) => {
  try {
    const cliClient = getCliClient();
    const round = await cliClient.getCurrentRound();
    res.json({ success: true, data: round });
  } catch (err) {
    if (USE_MOCK_FALLBACK) {
      res.json({ success: true, data: MOCK_ROUND, mock: true });
    } else {
      res.status(503).json({ success: false, error: { code: 'NODE_UNAVAILABLE', message: 'Cannot reach go-livepeer node' } });
    }
  }
});

// AI capabilities
router.get('/livepeer/ai/capabilities', async (_req, res) => {
  try {
    const cliClient = getCliClient();
    const capabilities = await cliClient.getNetworkCapabilities();
    res.json({ success: true, data: capabilities });
  } catch (err) {
    if (USE_MOCK_FALLBACK) {
      res.json({ success: true, data: MOCK_CAPABILITIES, mock: true });
    } else {
      res.status(503).json({ success: false, error: { code: 'NODE_UNAVAILABLE', message: 'Cannot reach go-livepeer node' } });
    }
  }
});

// Node management
router.get('/livepeer/nodes', async (_req, res) => {
  res.json({ success: true, data: Array.from(nodes.values()) });
});

router.post('/livepeer/nodes', async (req, res) => {
  const { id, name, cliUrl, aiUrl, mediaUrl, role } = req.body || {};
  if (!id || !cliUrl) {
    return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'id and cliUrl required' } });
  }
  if (!isAllowedLoopbackUrl(cliUrl)) {
    return res
      .status(400)
      .json({ success: false, error: { code: 'BAD_REQUEST', message: 'invalid cliUrl' } });
  }
  if (!isAllowedLoopbackUrl(aiUrl)) {
    return res
      .status(400)
      .json({ success: false, error: { code: 'BAD_REQUEST', message: 'invalid aiUrl' } });
  }
  registerNode({ id, name, cliUrl, aiUrl, mediaUrl, role });
  res.json({ success: true, data: nodes.get(id) });
});

// Gateway pricing (in-memory)
const gatewayPricing: { maxPricePerPixel?: string; maxPricePerCapability?: Record<string, string> } = {};

router.get('/livepeer/gateway/pricing', async (_req, res) => {
  res.json({ success: true, data: gatewayPricing });
});

router.post('/livepeer/gateway/pricing', async (req, res) => {
  const { maxPricePerPixel, maxPricePerCapability } = req.body || {};
  if (maxPricePerPixel !== undefined) gatewayPricing.maxPricePerPixel = String(maxPricePerPixel);
  if (maxPricePerCapability !== undefined) gatewayPricing.maxPricePerCapability = maxPricePerCapability;
  res.json({ success: true, data: gatewayPricing });
});

// AI pipeline proxy
router.post('/livepeer/ai/:pipeline', async (req, res) => {
  const pipeline = req.params.pipeline;
  try {
    const aiClient = getAiClient(req.query.nodeId as string | undefined);
    const result = await aiClient.processRequest(pipeline, req.body);
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'AI_FAILED', message: String(err) } });
  }
});

// Live video-to-video (proxy to AI client)
router.post('/livepeer/ai/live/:stream/start', async (req, res) => {
  try {
    const aiClient = getAiClient(req.query.nodeId as string | undefined);
    const session = await aiClient.startLiveVideoToVideo(req.params.stream, req.body);
    res.json({ success: true, data: session });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'AI_LIVE_START_FAILED', message: String(err) } });
  }
});

router.get('/livepeer/ai/live/:stream/status', async (req, res) => {
  try {
    const aiClient = getAiClient(req.query.nodeId as string | undefined);
    const status = await aiClient.getLiveVideoStatus(req.params.stream);
    res.json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'AI_LIVE_STATUS_FAILED', message: String(err) } });
  }
});

router.patch('/livepeer/ai/live/:stream/update', async (req, res) => {
  try {
    const aiClient = getAiClient(req.query.nodeId as string | undefined);
    await aiClient.updateLiveVideoToVideo(req.params.stream, req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'AI_LIVE_UPDATE_FAILED', message: String(err) } });
  }
});

// Metrics
router.get('/livepeer/metrics', async (_req, res) => {
  const avgLatencyMs = metrics.requests ? Math.round(metrics.totalLatencyMs / metrics.requests) : 0;
  res.json({
    success: true,
    data: {
      requests: metrics.requests,
      errors: metrics.errors,
      avgLatencyMs,
      lastUpdated: metrics.lastUpdated,
    },
  });
});

// ─── Start ──────────────────────────────────────────────────────────────────

start().catch((err) => {
  console.error('Failed to start livepeer-svc:', err);
  process.exit(1);
});
