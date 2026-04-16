/**
 * Hardcoded stub data for all facade functions.
 *
 * Used when FACADE_USE_STUBS=true. All values are typed against the same
 * interfaces as real resolvers — TypeScript will catch any shape drift.
 *
 * Stub data sampled from NAAP API.
 */

import type {
  DashboardKPI,
  DashboardPipelineUsage,
  DashboardPipelineCatalogEntry,
  DashboardOrchestrator,
  DashboardProtocol,
  DashboardFeesInfo,
  DashboardGPUCapacity,
  DashboardPipelinePricing,
} from '@naap/plugin-sdk';

import type { NetworkModel, JobFeedItem } from './types.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Fixed base timestamp for deterministic stub data (2026-04-16T09:00:00Z). */
const STUB_BASE_TS = 1_744_794_000_000;

/** Mulberry32 seeded PRNG — deterministic replacement for Math.random(). */
function seededRandom(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const rand = seededRandom(42);

function daysAgoUnix(n: number, baseTs = STUB_BASE_TS) {
  return Math.floor((baseTs - n * 86_400_000) / 1000);
}

// ---------------------------------------------------------------------------
// KPI — sampled from GET /v1/dashboard/kpi?window=24h (2026-04-16)
// ---------------------------------------------------------------------------

export const kpi: DashboardKPI = {
  successRate: { value: 85.6, delta: 0 },
  orchestratorsOnline: { value: 28, delta: 0 },
  dailyUsageMins: { value: 36493, delta: -9.4 },
  dailySessionCount: { value: 30104, delta: -2.8 },
  dailyNetworkFeesEth: { value: 0, delta: 0 },
  timeframeHours: 24,
  hourlySessions: [
    { hour: '2026-04-15T10:00:00Z', value: 1311 },
    { hour: '2026-04-15T11:00:00Z', value: 1288 },
    { hour: '2026-04-15T12:00:00Z', value: 1260 },
    { hour: '2026-04-15T13:00:00Z', value: 1224 },
    { hour: '2026-04-15T14:00:00Z', value: 1297 },
    { hour: '2026-04-15T15:00:00Z', value: 1285 },
    { hour: '2026-04-15T16:00:00Z', value: 1297 },
    { hour: '2026-04-15T17:00:00Z', value: 1301 },
    { hour: '2026-04-15T18:00:00Z', value: 1268 },
    { hour: '2026-04-15T19:00:00Z', value: 1218 },
    { hour: '2026-04-15T20:00:00Z', value: 1262 },
    { hour: '2026-04-15T21:00:00Z', value: 1257 },
    { hour: '2026-04-15T22:00:00Z', value: 1125 },
    { hour: '2026-04-15T23:00:00Z', value: 1276 },
    { hour: '2026-04-16T00:00:00Z', value: 1221 },
    { hour: '2026-04-16T01:00:00Z', value: 1198 },
    { hour: '2026-04-16T02:00:00Z', value: 1247 },
    { hour: '2026-04-16T03:00:00Z', value: 1297 },
    { hour: '2026-04-16T04:00:00Z', value: 1298 },
    { hour: '2026-04-16T05:00:00Z', value: 1250 },
    { hour: '2026-04-16T06:00:00Z', value: 1281 },
    { hour: '2026-04-16T07:00:00Z', value: 1222 },
    { hour: '2026-04-16T08:00:00Z', value: 1265 },
    { hour: '2026-04-16T09:00:00Z', value: 1156 },
  ],
  hourlyUsage: [
    { hour: '2026-04-15T10:00:00Z', value: 1520 },
    { hour: '2026-04-15T11:00:00Z', value: 1497 },
    { hour: '2026-04-15T12:00:00Z', value: 1528 },
    { hour: '2026-04-15T13:00:00Z', value: 1646 },
    { hour: '2026-04-15T14:00:00Z', value: 1495 },
    { hour: '2026-04-15T15:00:00Z', value: 1599 },
    { hour: '2026-04-15T16:00:00Z', value: 1579 },
    { hour: '2026-04-15T17:00:00Z', value: 1664 },
    { hour: '2026-04-15T18:00:00Z', value: 1552 },
    { hour: '2026-04-15T19:00:00Z', value: 1637 },
    { hour: '2026-04-15T20:00:00Z', value: 2005 },
    { hour: '2026-04-15T21:00:00Z', value: 1419 },
    { hour: '2026-04-15T22:00:00Z', value: 752 },
    { hour: '2026-04-15T23:00:00Z', value: 1641 },
    { hour: '2026-04-16T00:00:00Z', value: 1427 },
    { hour: '2026-04-16T01:00:00Z', value: 1415 },
    { hour: '2026-04-16T02:00:00Z', value: 1546 },
    { hour: '2026-04-16T03:00:00Z', value: 1452 },
    { hour: '2026-04-16T04:00:00Z', value: 1446 },
    { hour: '2026-04-16T05:00:00Z', value: 1696 },
    { hour: '2026-04-16T06:00:00Z', value: 1453 },
    { hour: '2026-04-16T07:00:00Z', value: 1481 },
    { hour: '2026-04-16T08:00:00Z', value: 1712 },
    { hour: '2026-04-16T09:00:00Z', value: 1331 },
  ],
};

// ---------------------------------------------------------------------------
// Pipelines — sampled from GET /v1/dashboard/pipelines?window=24h (2026-04-16)
// ---------------------------------------------------------------------------

export const pipelines: DashboardPipelineUsage[] = [
  {
    name: 'live-video-to-video',
    mins: 36191,
    sessions: 29841,
    avgFps: 17.4,
    color: '#10b981',
    modelMins: [
      { model: 'streamdiffusion-sdxl', mins: 23061, sessions: 18772, avgFps: 16.9 },
      { model: 'streamdiffusion-sdxl-v2v', mins: 12717, sessions: 10353, avgFps: 18.6 },
      { model: 'streamdiffusion', mins: 313, sessions: 636, avgFps: 12.8 },
      { model: 'streamdiffusion-sdturbo', mins: 54, sessions: 42, avgFps: 8.8 },
      { model: 'noop', mins: 42, sessions: 32, avgFps: 9.2 },
      { model: 'streamdiffusion-sdxl-faceid', mins: 5, sessions: 6, avgFps: 0 },
    ],
  },
  {
    name: 'noop',
    mins: 11,
    sessions: 13,
    avgFps: 12.3,
    color: '#6b7280',
  },
];

// ---------------------------------------------------------------------------
// Pipeline catalog — sampled from GET /v1/dashboard/pipeline-catalog (2026-04-16)
// ---------------------------------------------------------------------------

export const pipelineCatalog: DashboardPipelineCatalogEntry[] = [
  {
    id: 'live-video-to-video',
    name: 'live-video-to-video',
    models: ['streamdiffusion', 'streamdiffusion-sdturbo', 'streamdiffusion-sdxl', 'streamdiffusion-sdxl-v2v'],
    regions: [],
  },
  {
    id: 'llm',
    name: 'llm',
    models: ['glm-4.7-flash', 'llama3.2-vision', 'meta-llama/Meta-Llama-3.1-8B-Instruct'],
    regions: [],
  },
  {
    id: 'text-to-image',
    name: 'text-to-image',
    models: ['SG161222/RealVisXL_V4.0_Lightning'],
    regions: [],
  },
  {
    id: 'upscale',
    name: 'upscale',
    models: ['stabilityai/stable-diffusion-x4-upscaler'],
    regions: [],
  },
];

// ---------------------------------------------------------------------------
// Orchestrators — sampled from GET /v1/dashboard/orchestrators?window=24h (2026-04-16)
// ---------------------------------------------------------------------------

export const orchestrators: DashboardOrchestrator[] = [
  {
    address: '0x3b28a7d785356dc67c7970666747e042305bfb79',
    uris: ['https://ai.ad-astra.live:9966'],
    knownSessions: 4829,
    successSessions: 4823,
    successRatio: 99.9,
    effectiveSuccessRate: 99.9,
    noSwapRatio: 99.2,
    slaScore: 99,
    pipelines: ['live-video-to-video'],
    pipelineModels: [
      { pipelineId: 'live-video-to-video', modelIds: ['streamdiffusion', 'streamdiffusion-sdxl', 'streamdiffusion-sdxl-v2v'] },
    ],
    gpuCount: 2,
  },
  {
    address: '0xb120a72a9264e90092e8197c0fabd210c18bc5be',
    uris: ['https://ai.lpt-1.moudi.network:18935'],
    knownSessions: 4828,
    successSessions: 4818,
    successRatio: 99.5,
    effectiveSuccessRate: 99.5,
    noSwapRatio: 96.5,
    slaScore: 92,
    pipelines: ['live-video-to-video'],
    pipelineModels: [
      { pipelineId: 'live-video-to-video', modelIds: ['streamdiffusion-sdxl', 'streamdiffusion-sdxl-v2v'] },
    ],
    gpuCount: 11,
  },
  {
    address: '0xdc28f2842810d1a013ad51de174d02eaba192dc7',
    uris: ['https://ai.pon-eth.com:9191'],
    knownSessions: 2680,
    successSessions: 2672,
    successRatio: 99.6,
    effectiveSuccessRate: 99.6,
    noSwapRatio: 97.5,
    slaScore: 98,
    pipelines: ['live-video-to-video'],
    pipelineModels: [
      { pipelineId: 'live-video-to-video', modelIds: ['streamdiffusion-sdxl', 'streamdiffusion-sdxl-v2v'] },
    ],
    gpuCount: 2,
  },
  {
    address: '0x104a7ca059a35fd4def5ecb16600b2caa1fe1361',
    uris: ['https://ai.eliteencoder.net:8936'],
    knownSessions: 1494,
    successSessions: 1485,
    successRatio: 98.9,
    effectiveSuccessRate: 98.9,
    noSwapRatio: 98.3,
    slaScore: 93,
    pipelines: ['live-video-to-video'],
    pipelineModels: [
      { pipelineId: 'live-video-to-video', modelIds: ['noop', 'streamdiffusion-sdturbo', 'streamdiffusion-sdxl', 'streamdiffusion-sdxl-v2v'] },
    ],
    gpuCount: 2,
  },
];

// ---------------------------------------------------------------------------
// Protocol — illustrative (The Graph backed, not NAAP API)
// ---------------------------------------------------------------------------

export const protocol: DashboardProtocol = {
  currentRound: 4_521,
  blockProgress: 68,
  totalBlocks: 100,
  totalStakedLPT: 15_234_891.5,
};

// ---------------------------------------------------------------------------
// Fees — illustrative (The Graph backed, not NAAP API)
// ---------------------------------------------------------------------------

const dayDataCount = 180;
export const fees: DashboardFeesInfo = {
  totalEth: 4_213.87,
  totalUsd: 12_045_000,
  oneDayVolumeUsd: 18_420,
  oneDayVolumeEth: 6.43,
  oneWeekVolumeUsd: 124_500,
  oneWeekVolumeEth: 43.5,
  volumeChangeUsd: 8.5,
  volumeChangeEth: 7.2,
  weeklyVolumeChangeUsd: 3.1,
  weeklyVolumeChangeEth: 2.8,
  dayData: Array.from({ length: dayDataCount }, (_, i) => ({
    dateS: daysAgoUnix(dayDataCount - i - 1),
    volumeEth: parseFloat((rand() * 8 + 2).toFixed(4)),
    volumeUsd: Math.round(rand() * 25_000 + 5_000),
  })),
  weeklyData: Array.from({ length: 26 }, (_, i) => ({
    date: daysAgoUnix((26 - i - 1) * 7),
    weeklyVolumeUsd: Math.round(rand() * 120_000 + 40_000),
    weeklyVolumeEth: parseFloat((rand() * 40 + 15).toFixed(4)),
  })),
};

// ---------------------------------------------------------------------------
// GPU capacity — sampled from GET /v1/dashboard/gpu-capacity (2026-04-16)
// ---------------------------------------------------------------------------

export const gpuCapacity: DashboardGPUCapacity = {
  totalGPUs: 55,
  activeGPUs: 55,
  availableCapacity: 1.0,
  models: [
    { model: 'NVIDIA GeForce RTX 4090', count: 29 },
    { model: 'NVIDIA GeForce RTX 5090', count: 22 },
    { model: 'NVIDIA GeForce RTX 3090', count: 3 },
    { model: 'NVIDIA GeForce RTX 4070 Ti SUPER', count: 1 },
  ],
  pipelineGPUs: [
    {
      name: 'live-video-to-video',
      gpus: 51,
      models: [
        { model: 'streamdiffusion-sdxl', gpus: 37 },
        { model: 'streamdiffusion-sdxl-v2v', gpus: 10 },
        { model: 'streamdiffusion', gpus: 3 },
        { model: 'streamdiffusion-sdturbo', gpus: 1 },
      ],
    },
    {
      name: 'text-to-image',
      gpus: 2,
      models: [
        { model: 'SG161222/RealVisXL_V4.0_Lightning', gpus: 2 },
      ],
    },
    {
      name: 'upscale',
      gpus: 2,
      models: [
        { model: 'stabilityai/stable-diffusion-x4-upscaler', gpus: 2 },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Pricing — sampled from GET /v1/dashboard/pricing (2026-04-16)
// Aggregated from per-orchestrator rows into per (pipeline, model) summary
// ---------------------------------------------------------------------------

export const pricing: DashboardPipelinePricing[] = [
  { pipeline: 'live-video-to-video', model: 'streamdiffusion-sdxl', unit: 'pixel', price: 0.000_000_000_429, avgWeiPerUnit: '429', pixelsPerUnit: 1, outputPerDollar: '~777B pixels', capacity: 23 },
  { pipeline: 'live-video-to-video', model: 'streamdiffusion-sdxl-v2v', unit: 'pixel', price: 0.000_000_002_15, avgWeiPerUnit: '2146', pixelsPerUnit: 1, outputPerDollar: '~155B pixels', capacity: 5 },
  { pipeline: 'live-video-to-video', model: 'streamdiffusion-sdturbo', unit: 'pixel', price: 0.000_000_002_15, avgWeiPerUnit: '2146', pixelsPerUnit: 1, outputPerDollar: '~155B pixels', capacity: 1 },
  { pipeline: 'live-video-to-video', model: 'streamdiffusion', unit: 'pixel', price: 0.000_000_002_15, avgWeiPerUnit: '2146', pixelsPerUnit: 1, outputPerDollar: '~155B pixels', capacity: 2 },
  { pipeline: 'text-to-image', model: 'SG161222/RealVisXL_V4.0_Lightning', unit: 'pixel', price: 0.000_004_77, avgWeiPerUnit: '4768371', pixelsPerUnit: 1, outputPerDollar: '~70K pixels', capacity: 2 },
  { pipeline: 'upscale', model: 'stabilityai/stable-diffusion-x4-upscaler', unit: 'pixel', price: 0.000_009_12, avgWeiPerUnit: '9123537', pixelsPerUnit: 1, outputPerDollar: '~37K pixels', capacity: 2 },
  { pipeline: 'llm', model: 'glm-4.7-flash', unit: 'token', price: 0.000_023_92, avgWeiPerUnit: '23920000', pixelsPerUnit: null, outputPerDollar: '~14K tokens', capacity: 1 },
  { pipeline: 'llm', model: 'meta-llama/Meta-Llama-3.1-8B-Instruct', unit: 'token', price: 0.000_038_27, avgWeiPerUnit: '38270000', pixelsPerUnit: null, outputPerDollar: '~9K tokens', capacity: 1 },
  { pipeline: 'llm', model: 'llama3.2-vision', unit: 'token', price: 0.000_043_05, avgWeiPerUnit: '43050000', pixelsPerUnit: null, outputPerDollar: '~8K tokens', capacity: 1 },
];

// ---------------------------------------------------------------------------
// Job feed — sampled from GET /v1/dashboard/job-feed?limit=5 (2026-04-16)
// ---------------------------------------------------------------------------

export const jobFeed: JobFeedItem[] = [
  {
    id: '292c2c61-32f5-4fee-b26d-d21bf6b86f9c',
    pipeline: 'live-video-to-video',
    model: 'streamdiffusion-sdxl',
    gateway: 'ai-live-video-tester-sea',
    orchestratorAddress: '0x104a7ca059a35fd4def5ecb16600b2caa1fe1361',
    orchestratorUrl: 'https://ai.eliteencoder.net:8936',
    state: 'DEGRADED_INPUT',
    job_type: 'streaming',
    inputFps: 9.7,
    outputFps: 8.6,
    firstSeen: '2026-04-16T09:43:23Z',
    lastSeen: '2026-04-16T09:44:34Z',
    durationSeconds: 90,
  },
  {
    id: 'ec69ea69-2ab1-4431-aadf-bbad318d8d50',
    pipeline: 'live-video-to-video',
    model: 'streamdiffusion-sdxl',
    gateway: 'fra-ai-prod-livepeer-ai-gateway-1.livepeer.com',
    orchestratorAddress: '0xb120a72a9264e90092e8197c0fabd210c18bc5be',
    orchestratorUrl: 'https://ai.lpt-1.moudi.network:18935',
    state: 'ONLINE',
    job_type: 'streaming',
    inputFps: 24.0,
    outputFps: 17.9,
    firstSeen: '2026-04-16T09:43:41Z',
    lastSeen: '2026-04-16T09:44:32Z',
    durationSeconds: 72,
  },
  {
    id: '8665a806-f30a-4329-964d-a563998488db',
    pipeline: 'live-video-to-video',
    model: 'streamdiffusion-sdxl-v2v',
    gateway: 'nyc-ai-prod-livepeer-ai-gateway-1.livepeer.com',
    orchestratorAddress: '0xb8c66a19c2d4ccfe79e002d9e3a02dff73de4aba',
    orchestratorUrl: 'https://ai.organic-node.uk:59165',
    state: 'DEGRADED_INFERENCE',
    job_type: 'streaming',
    inputFps: 394.3,
    outputFps: 0,
    firstSeen: '2026-04-16T09:44:25Z',
    lastSeen: '2026-04-16T09:44:32Z',
    durationSeconds: 29,
  },
  {
    id: '951d9afb-142b-4521-8640-3d026bb9ceb2',
    pipeline: 'live-video-to-video',
    model: 'streamdiffusion-sdxl',
    gateway: 'lax-ai-prod-livepeer-ai-gateway-1.livepeer.com',
    orchestratorAddress: '0x4416a274f86e1db860b513548b672154d43b81b2',
    orchestratorUrl: 'https://livepeer-msi-1.prod.dcg-labs.co:8935',
    state: 'ONLINE',
    job_type: 'streaming',
    inputFps: 24.1,
    outputFps: 18.3,
    firstSeen: '2026-04-16T09:43:31Z',
    lastSeen: '2026-04-16T09:44:31Z',
    durationSeconds: 83,
  },
  {
    id: 'a4b424c4-0405-43e2-835a-4822bce3d47b',
    pipeline: 'live-video-to-video',
    model: 'streamdiffusion-sdxl',
    gateway: 'nyc-ai-prod-livepeer-ai-gateway-0.livepeer.com',
    orchestratorAddress: '0x47a907a0bd1627d71cd14430a721d1550d6d6f58',
    orchestratorUrl: 'https://ai.nightnode.net:8888',
    state: 'ONLINE',
    job_type: 'streaming',
    inputFps: 24.1,
    outputFps: 21.5,
    firstSeen: '2026-04-16T09:43:20Z',
    lastSeen: '2026-04-16T09:44:31Z',
    durationSeconds: 93,
  },
];

// ---------------------------------------------------------------------------
// Network models — sampled from GET /v1/streaming/models + /v1/requests/models (2026-04-16)
// ---------------------------------------------------------------------------

export const networkModels: NetworkModel[] = [
  { Pipeline: 'live-video-to-video', Model: 'streamdiffusion-sdxl', WarmOrchCount: 23, TotalCapacity: 37, PriceMinWeiPerPixel: 0, PriceMaxWeiPerPixel: 0, PriceAvgWeiPerPixel: 0 },
  { Pipeline: 'live-video-to-video', Model: 'streamdiffusion-sdxl-v2v', WarmOrchCount: 5, TotalCapacity: 10, PriceMinWeiPerPixel: 0, PriceMaxWeiPerPixel: 0, PriceAvgWeiPerPixel: 0 },
  { Pipeline: 'live-video-to-video', Model: 'streamdiffusion', WarmOrchCount: 2, TotalCapacity: 3, PriceMinWeiPerPixel: 0, PriceMaxWeiPerPixel: 0, PriceAvgWeiPerPixel: 0 },
  { Pipeline: 'live-video-to-video', Model: 'streamdiffusion-sdturbo', WarmOrchCount: 1, TotalCapacity: 1, PriceMinWeiPerPixel: 0, PriceMaxWeiPerPixel: 0, PriceAvgWeiPerPixel: 0 },
  { Pipeline: 'openai-chat-completions', Model: 'Qwen/Qwen2.5-14B-Instruct-AWQ', WarmOrchCount: 1, TotalCapacity: 0, PriceMinWeiPerPixel: 0, PriceMaxWeiPerPixel: 0, PriceAvgWeiPerPixel: 0 },
  { Pipeline: 'text-to-image', Model: 'SG161222/RealVisXL_V4.0_Lightning', WarmOrchCount: 2, TotalCapacity: 2, PriceMinWeiPerPixel: 0, PriceMaxWeiPerPixel: 0, PriceAvgWeiPerPixel: 0 },
  { Pipeline: 'llm', Model: 'meta-llama/Meta-Llama-3.1-8B-Instruct', WarmOrchCount: 1, TotalCapacity: 0, PriceMinWeiPerPixel: 0, PriceMaxWeiPerPixel: 0, PriceAvgWeiPerPixel: 0 },
  { Pipeline: 'upscale', Model: 'stabilityai/stable-diffusion-x4-upscaler', WarmOrchCount: 2, TotalCapacity: 2, PriceMinWeiPerPixel: 0, PriceMaxWeiPerPixel: 0, PriceAvgWeiPerPixel: 0 },
  { Pipeline: 'openai-text-embeddings', Model: 'nomic-embed-text:latest', WarmOrchCount: 2, TotalCapacity: 0, PriceMinWeiPerPixel: 0, PriceMaxWeiPerPixel: 0, PriceAvgWeiPerPixel: 0 },
  { Pipeline: 'openai-image-generation', Model: 'black-forest-labs/FLUX.1-dev', WarmOrchCount: 1, TotalCapacity: 0, PriceMinWeiPerPixel: 0, PriceMaxWeiPerPixel: 0, PriceAvgWeiPerPixel: 0 },
];
