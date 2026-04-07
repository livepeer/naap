/**
 * Hardcoded stub data for all facade functions.
 *
 * Used when FACADE_USE_STUBS=true. All values are typed against the same
 * interfaces as real resolvers — TypeScript will catch any shape drift.
 *
 * Replace each stub with a real resolver import as backends are wired in
 * (Phases 1-4). The stubs intentionally use plausible-looking numbers so
 * the UI renders realistically during development.
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

/** Fixed base timestamp for deterministic stub data (2026-03-31T12:00:00Z). */
const STUB_BASE_TS = 1_743_339_600_000;

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

function hourlyBuckets(baseValue: number, count = 24) {
  const now = new Date(STUB_BASE_TS);
  return Array.from({ length: count }, (_, i) => {
    const h = new Date(now);
    h.setHours(now.getHours() - (count - 1 - i), 0, 0, 0);
    const jitter = 1 + (Math.sin(i * 0.7) * 0.2);
    return { hour: h.toISOString(), value: Math.round(baseValue * jitter) };
  });
}

function daysAgoUnix(n: number, baseTs = STUB_BASE_TS) {
  return Math.floor((baseTs - n * 86_400_000) / 1000);
}

// ---------------------------------------------------------------------------
// Pipelines — real pipeline counts from /v1/net/orchestrators RawCapabilities (2026-03-31)
// Sessions for live-video-to-video from /v1/pipelines; others have 0 demand currently
// ---------------------------------------------------------------------------

export const pipelines: DashboardPipelineUsage[] = [
  {
    name: 'live-video-to-video',
    mins: 0,
    sessions: 36_456,
    avgFps: 15.7,
    color: '#10b981',
    modelMins: [
      { model: 'streamdiffusion-sdxl',     mins: 0, sessions: 22_785, avgFps: 15.7 },
      { model: 'streamdiffusion-sdxl-v2v', mins: 0, sessions: 10_214, avgFps: 15.6 },
      { model: 'streamdiffusion',           mins: 0, sessions: 3_212,  avgFps: 15.9 },
      { model: 'streamdiffusion-sdturbo',   mins: 0, sessions: 245,    avgFps: 16.1 },
    ],
  },
  {
    name: 'text-to-image',
    mins: 0,
    sessions: 124,
    avgFps: 0,
    color: '#f59e0b',
    modelMins: [
      { model: 'SG161222/RealVisXL_V4.0_Lightning', mins: 0, sessions: 80, avgFps: 0 },
      { model: 'ByteDance/SDXL-Lightning',           mins: 0, sessions: 44, avgFps: 0 },
    ],
  },
  {
    name: 'upscale',
    mins: 0,
    sessions: 87,
    avgFps: 0,
    color: '#84cc16',
    modelMins: [
      { model: 'stabilityai/stable-diffusion-x4-upscaler', mins: 0, sessions: 87, avgFps: 0 },
    ],
  },
  {
    name: 'audio-to-text',
    mins: 0,
    sessions: 62,
    avgFps: 0,
    color: '#06b6d4',
    modelMins: [
      { model: 'openai/whisper-large-v3', mins: 0, sessions: 62, avgFps: 0 },
    ],
  },
  {
    name: 'llm',
    mins: 0,
    sessions: 38,
    avgFps: 0,
    color: '#a855f7',
    modelMins: [
      { model: 'glm-4.7-flash',                          mins: 0, sessions: 18, avgFps: 0 },
      { model: 'meta-llama/Meta-Llama-3.1-8B-Instruct',  mins: 0, sessions: 14, avgFps: 0 },
      { model: 'llama3.2-vision',                        mins: 0, sessions: 6,  avgFps: 0 },
    ],
  },
  {
    name: 'image-to-image',
    mins: 0,
    sessions: 29,
    avgFps: 0,
    color: '#8b5cf6',
    modelMins: [
      { model: 'timbrooks/instruct-pix2pix', mins: 0, sessions: 29, avgFps: 0 },
    ],
  },
  {
    name: 'image-to-video',
    mins: 0,
    sessions: 21,
    avgFps: 0,
    color: '#3b82f6',
    modelMins: [
      { model: 'stabilityai/stable-video-diffusion-img2vid-xt-1-1', mins: 0, sessions: 21, avgFps: 0 },
    ],
  },
  {
    name: 'segment-anything-2',
    mins: 0,
    sessions: 14,
    avgFps: 0,
    color: '#f97316',
    modelMins: [
      { model: 'facebook/sam2-hiera-large', mins: 0, sessions: 14, avgFps: 0 },
    ],
  },
  {
    name: 'text-to-speech',
    mins: 0,
    sessions: 9,
    avgFps: 0,
    color: '#14b8a6',
    modelMins: [
      { model: 'parler-tts/parler-tts-large-v1', mins: 0, sessions: 9, avgFps: 0 },
    ],
  },
];

// ---------------------------------------------------------------------------
// KPI — derived from pipeline stubs + /v1/net/summary patterns
// ---------------------------------------------------------------------------

const _totalPipelineMins = pipelines.reduce((s, p) => s + p.mins, 0);
const _totalPipelineSessions = pipelines.reduce((s, p) => s + p.sessions, 0);
const _hourlyUsage = hourlyBuckets(Math.round(_totalPipelineMins / 24));
const _hourlySessions = hourlyBuckets(Math.round(_totalPipelineSessions / 24));

export const kpi: DashboardKPI = {
  successRate: { value: 77.8, delta: -2.1 },
  orchestratorsOnline: { value: 33, delta: 0 },
  dailyUsageMins: { value: _hourlyUsage.reduce((s, b) => s + b.value, 0), delta: 3.4 },
  dailySessionCount: { value: _hourlySessions.reduce((s, b) => s + b.value, 0), delta: 5.2 },
  dailyNetworkFeesEth: { value: 6.43, delta: 7.2 },
  timeframeHours: 24,
  hourlyUsage: _hourlyUsage,
  hourlySessions: _hourlySessions,
};

// ---------------------------------------------------------------------------
// Pipeline catalog — all pipelines+models from /v1/net/orchestrators (2026-03-31)
// ---------------------------------------------------------------------------

export const pipelineCatalog: DashboardPipelineCatalogEntry[] = [
  {
    id: 'live-video-to-video',
    name: 'Live Video-to-Video',
    models: ['streamdiffusion-sdxl', 'streamdiffusion-sdxl-v2v', 'streamdiffusion', 'streamdiffusion-sdturbo'],
    regions: [],
  },
  {
    id: 'text-to-image',
    name: 'Text-to-Image',
    models: ['SG161222/RealVisXL_V4.0_Lightning', 'ByteDance/SDXL-Lightning'],
    regions: [],
  },
  {
    id: 'upscale',
    name: 'Upscale',
    models: ['stabilityai/stable-diffusion-x4-upscaler'],
    regions: [],
  },
  {
    id: 'audio-to-text',
    name: 'Audio-to-Text',
    models: ['openai/whisper-large-v3'],
    regions: [],
  },
  {
    id: 'llm',
    name: 'LLM',
    models: ['glm-4.7-flash', 'meta-llama/Meta-Llama-3.1-8B-Instruct', 'llama3.2-vision'],
    regions: [],
  },
  {
    id: 'image-to-image',
    name: 'Image-to-Image',
    models: ['timbrooks/instruct-pix2pix'],
    regions: [],
  },
  {
    id: 'image-to-video',
    name: 'Image-to-Video',
    models: ['stabilityai/stable-video-diffusion-img2vid-xt-1-1'],
    regions: [],
  },
  {
    id: 'segment-anything-2',
    name: 'Segment Anything 2',
    models: ['facebook/sam2-hiera-large'],
    regions: [],
  },
  {
    id: 'text-to-speech',
    name: 'Text-to-Speech',
    models: ['parler-tts/parler-tts-large-v1'],
    regions: [],
  },
];

// ---------------------------------------------------------------------------
// Orchestrators — real addresses from /v1/net/orchestrators (2026-03-31)
// SLA scores are illustrative (derived from /v1/sla/compliance shape)
// ---------------------------------------------------------------------------

export const orchestrators: DashboardOrchestrator[] = [
  {
    address: '0x3b28a7d785356dc67c7970666747e042305bfb79', // ai.ad-astra.live — top live-v2v orch
    uris: ['https://ai.ad-astra.live:9966'],
    knownSessions: 8_420,
    successSessions: 6_854,
    successRatio: 81.4,
    effectiveSuccessRate: 79.2,
    noSwapRatio: 91.3,
    slaScore: 84,
    pipelines: ['live-video-to-video'],
    pipelineModels: [
      { pipelineId: 'live-video-to-video', modelIds: ['streamdiffusion-sdxl', 'streamdiffusion-sdxl-v2v'] },
    ],
    gpuCount: 4,
  },
  {
    address: '0xd00354656922168815fcd1e51cbddb9e359e3c7f', // rtav-orch.xodeapp.xyz — two service URIs
    uris: ['https://rtav-orch.xodeapp.xyz:28935', 'https://livepeer-ai.xodeapp.xyz:18935'],
    knownSessions: 5_130,
    successSessions: 4_217,
    successRatio: 82.2,
    effectiveSuccessRate: 80.5,
    noSwapRatio: 93.1,
    slaScore: 86,
    pipelines: ['live-video-to-video'],
    pipelineModels: [
      { pipelineId: 'live-video-to-video', modelIds: ['streamdiffusion-sdxl'] },
    ],
    gpuCount: 3,
  },
  {
    address: '0x22b1bcc0c0db224bfc56c9b95a2db407548666ee', // lpt.thomasblock.io — two service URIs
    uris: ['https://lpt.thomasblock.io:20110', 'https://45.153.35.148:20080'],
    knownSessions: 4_890,
    successSessions: 3_921,
    successRatio: 80.2,
    effectiveSuccessRate: 78.8,
    noSwapRatio: 90.7,
    slaScore: 82,
    pipelines: ['live-video-to-video'],
    pipelineModels: [
      { pipelineId: 'live-video-to-video', modelIds: ['streamdiffusion-sdxl', 'streamdiffusion'] },
    ],
    gpuCount: 2,
  },
  {
    address: '0xb8c66a19c2d4ccfe79e002d9e3a02dff73de4aba', // ai.organic-node.uk
    uris: ['https://ai.organic-node.uk:6500'],
    knownSessions: 3_210,
    successSessions: 2_589,
    successRatio: 80.7,
    effectiveSuccessRate: 79.1,
    noSwapRatio: 92.4,
    slaScore: 83,
    pipelines: ['live-video-to-video'],
    pipelineModels: [
      { pipelineId: 'live-video-to-video', modelIds: ['streamdiffusion-sdxl-v2v'] },
    ],
    gpuCount: 2,
  },
  {
    address: '0xd4c467d8c13752ab7bb9711bc77de2a9f52a65f6', // 2.9.173.59 — top orch for llm/upscale/text-to-image
    uris: ['https://example.invalid/orch/d4c467d8'],
    knownSessions: 0,
    successSessions: 0,
    successRatio: 0,
    effectiveSuccessRate: null,
    noSwapRatio: null,
    slaScore: null,
    pipelines: ['llm', 'text-to-image', 'upscale'],
    pipelineModels: [
      { pipelineId: 'llm', modelIds: ['glm-4.7-flash', 'meta-llama/Meta-Llama-3.1-8B-Instruct', 'llama3.2-vision'] },
      { pipelineId: 'text-to-image', modelIds: ['SG161222/RealVisXL_V4.0_Lightning'] },
      { pipelineId: 'upscale', modelIds: ['stabilityai/stable-diffusion-x4-upscaler'] },
    ],
    gpuCount: 1,
  },
];

// ---------------------------------------------------------------------------
// Protocol
// ---------------------------------------------------------------------------

export const protocol: DashboardProtocol = {
  currentRound: 4_521,
  blockProgress: 68,
  totalBlocks: 100,
  totalStakedLPT: 15_234_891.5,
};

// ---------------------------------------------------------------------------
// Fees
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
// GPU capacity — illustrative; real data comes from /v1/gpu/metrics
// ---------------------------------------------------------------------------

export const gpuCapacity: DashboardGPUCapacity = {
  totalGPUs: 67,
  activeGPUs: 67,
  availableCapacity: 1.0,
  models: [
    { model: 'NVIDIA RTX 4090', count: 36 },
    { model: 'NVIDIA RTX 3090', count: 18 },
    { model: 'NVIDIA A100', count: 5 },
    { model: 'NVIDIA RTX 4080', count: 8 },
  ],
  pipelineGPUs: [
    {
      name: 'live-video-to-video',
      gpus: 60,
      models: [
        { model: 'NVIDIA RTX 4090', gpus: 34 },
        { model: 'NVIDIA RTX 3090', gpus: 18 },
        { model: 'NVIDIA RTX 4080', gpus: 8 },
      ],
    },
    {
      name: 'llm',
      gpus: 5,
      models: [
        { model: 'NVIDIA A100', gpus: 5 },
      ],
    },
    {
      name: 'text-to-image',
      gpus: 2,
      models: [
        { model: 'NVIDIA RTX 4090', gpus: 2 },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Pricing — derived from real /v1/net/models data (2026-03-31)
// price = PriceAvgWeiPerPixel / 1e12
// outputPerDollar = 1e18 / (ETH_USD_PRICE * PriceAvgWeiPerPixel) — see pricing resolver
// ---------------------------------------------------------------------------

export const pricing: DashboardPipelinePricing[] = [
  // live-video-to-video models (Wei/pixel scale ~2400 → ~2.4e-9 per pixel)
  { pipeline: 'live-video-to-video', model: 'streamdiffusion-sdxl',     unit: 'pixel', price: 0.000_000_002_23, avgWeiPerUnit: '2230', pixelsPerUnit: 1, outputPerDollar: '~149B pixels' },
  { pipeline: 'live-video-to-video', model: 'streamdiffusion-sdxl-v2v', unit: 'pixel', price: 0.000_000_002_40, avgWeiPerUnit: '2400', pixelsPerUnit: 1, outputPerDollar: '~139B pixels' },
  { pipeline: 'live-video-to-video', model: 'streamdiffusion',          unit: 'pixel', price: 0.000_000_002_40, avgWeiPerUnit: '2400', pixelsPerUnit: 1, outputPerDollar: '~139B pixels' },
  { pipeline: 'live-video-to-video', model: 'streamdiffusion-sdturbo',  unit: 'pixel', price: 0.000_000_002_40, avgWeiPerUnit: '2400', pixelsPerUnit: 1, outputPerDollar: '~139B pixels' },
  // text-to-image
  { pipeline: 'text-to-image', model: 'SG161222/RealVisXL_V4.0_Lightning', unit: 'pixel', price: 0.000_004_77, avgWeiPerUnit: '4770000', pixelsPerUnit: 1, outputPerDollar: '~70K pixels' },
  // upscale
  { pipeline: 'upscale', model: 'stabilityai/stable-diffusion-x4-upscaler', unit: 'pixel', price: 0.000_009_12, avgWeiPerUnit: '9120000', pixelsPerUnit: 1, outputPerDollar: '~37K pixels' },
  // llm (Wei/token scale ~24M–43M → ~0.024–0.043 per token)
  { pipeline: 'llm', model: 'glm-4.7-flash',                            unit: 'token', price: 0.000_023_92, avgWeiPerUnit: '23920000', pixelsPerUnit: null, outputPerDollar: '~14K tokens' },
  { pipeline: 'llm', model: 'meta-llama/Meta-Llama-3.1-8B-Instruct',   unit: 'token', price: 0.000_038_27, avgWeiPerUnit: '38270000', pixelsPerUnit: null, outputPerDollar: '~8.7K tokens' },
  { pipeline: 'llm', model: 'llama3.2-vision',                          unit: 'token', price: 0.000_043_05, avgWeiPerUnit: '43050000', pixelsPerUnit: null, outputPerDollar: '~7.7K tokens' },
];

// ---------------------------------------------------------------------------
// Job feed — real model names from /v1/net/models + real orch addresses
// ---------------------------------------------------------------------------

export const jobFeed: JobFeedItem[] = [
  {
    id: 'stream-a1b2c3d4',
    pipeline: 'live-video-to-video',
    model: 'streamdiffusion-sdxl',
    gateway: 'gateway.livepeer.cloud',
    orchestratorUrl: 'https://ai.ad-astra.live:9966',
    state: 'running',
    inputFps: 30,
    outputFps: 15.8,
    firstSeen: new Date(Date.now() - 142_000).toISOString(),
    lastSeen: new Date(Date.now() - 1_000).toISOString(),
    durationSeconds: 142,
    runningFor: '2m 22s',
  },
  {
    id: 'stream-b2c3d4e5',
    pipeline: 'live-video-to-video',
    model: 'streamdiffusion-sdxl-v2v',
    gateway: 'gateway.livepeer.cloud',
    orchestratorUrl: 'https://rtav-orch.xodeapp.xyz:28935',
    state: 'running',
    inputFps: 30,
    outputFps: 15.6,
    firstSeen: new Date(Date.now() - 67_000).toISOString(),
    lastSeen: new Date(Date.now() - 1_000).toISOString(),
    durationSeconds: 67,
    runningFor: '1m 7s',
  },
  {
    id: 'stream-c3d4e5f6',
    pipeline: 'live-video-to-video',
    model: 'streamdiffusion-sdxl',
    gateway: 'gateway.livepeer.cloud',
    orchestratorUrl: 'https://lpt.thomasblock.io:20110',
    state: 'running',
    inputFps: 30,
    outputFps: 16.1,
    firstSeen: new Date(Date.now() - 23_000).toISOString(),
    lastSeen: new Date(Date.now() - 1_000).toISOString(),
    durationSeconds: 23,
    runningFor: '23s',
  },
  {
    id: 'stream-d4e5f6a7',
    pipeline: 'live-video-to-video',
    model: 'streamdiffusion',
    gateway: 'gateway.livepeer.cloud',
    orchestratorUrl: 'https://ai.organic-node.uk:59165',
    state: 'running',
    inputFps: 30,
    outputFps: 15.9,
    firstSeen: new Date(Date.now() - 310_000).toISOString(),
    lastSeen: new Date(Date.now() - 1_000).toISOString(),
    durationSeconds: 310,
    runningFor: '5m 10s',
  },
  {
    id: 'stream-e5f6a7b8',
    pipeline: 'live-video-to-video',
    model: 'streamdiffusion-sdxl',
    gateway: 'gateway.livepeer.cloud',
    orchestratorUrl: 'https://ai.ad-astra.live:9966',
    state: 'degraded_inference',
    inputFps: 30,
    outputFps: 7.4,
    firstSeen: new Date(Date.now() - 88_000).toISOString(),
    lastSeen: new Date(Date.now() - 1_000).toISOString(),
    durationSeconds: 88,
    runningFor: '1m 28s',
  },
];

// ---------------------------------------------------------------------------
// Network models — exact data from /v1/net/models (2026-03-31)
// ---------------------------------------------------------------------------

export const networkModels: NetworkModel[] = [
  { Pipeline: 'live-video-to-video', Model: 'streamdiffusion-sdxl',                        WarmOrchCount: 16, TotalCapacity: 16, PriceMinWeiPerPixel: 480,        PriceMaxWeiPerPixel: 2_536,        PriceAvgWeiPerPixel: 2_229.875 },
  { Pipeline: 'live-video-to-video', Model: 'streamdiffusion-sdxl-v2v',                    WarmOrchCount: 8,  TotalCapacity: 8,  PriceMinWeiPerPixel: 2_381,       PriceMaxWeiPerPixel: 2_402,        PriceAvgWeiPerPixel: 2_399.375 },
  { Pipeline: 'live-video-to-video', Model: 'streamdiffusion',                              WarmOrchCount: 3,  TotalCapacity: 3,  PriceMinWeiPerPixel: 2_392,       PriceMaxWeiPerPixel: 2_402,        PriceAvgWeiPerPixel: 2_398.667 },
  { Pipeline: 'live-video-to-video', Model: 'streamdiffusion-sdturbo',                     WarmOrchCount: 1,  TotalCapacity: 1,  PriceMinWeiPerPixel: 2_398,       PriceMaxWeiPerPixel: 2_398,        PriceAvgWeiPerPixel: 2_398 },
  { Pipeline: 'llm',                 Model: 'glm-4.7-flash',                               WarmOrchCount: 1,  TotalCapacity: 1,  PriceMinWeiPerPixel: 23_916_807,  PriceMaxWeiPerPixel: 23_916_807,   PriceAvgWeiPerPixel: 23_916_807 },
  { Pipeline: 'llm',                 Model: 'meta-llama/Meta-Llama-3.1-8B-Instruct',       WarmOrchCount: 1,  TotalCapacity: 1,  PriceMinWeiPerPixel: 38_266_892,  PriceMaxWeiPerPixel: 38_266_892,   PriceAvgWeiPerPixel: 38_266_892 },
  { Pipeline: 'llm',                 Model: 'llama3.2-vision',                             WarmOrchCount: 1,  TotalCapacity: 1,  PriceMinWeiPerPixel: 43_050_253,  PriceMaxWeiPerPixel: 43_050_253,   PriceAvgWeiPerPixel: 43_050_253 },
  { Pipeline: 'text-to-image',       Model: 'SG161222/RealVisXL_V4.0_Lightning',           WarmOrchCount: 1,  TotalCapacity: 1,  PriceMinWeiPerPixel: 4_768_371,   PriceMaxWeiPerPixel: 4_768_371,    PriceAvgWeiPerPixel: 4_768_371 },
  { Pipeline: 'upscale',             Model: 'stabilityai/stable-diffusion-x4-upscaler',   WarmOrchCount: 1,  TotalCapacity: 1,  PriceMinWeiPerPixel: 9_123_537,   PriceMaxWeiPerPixel: 9_123_537,    PriceAvgWeiPerPixel: 9_123_537 },
];
