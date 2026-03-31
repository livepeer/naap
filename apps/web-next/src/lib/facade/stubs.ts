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

function hourlyBuckets(baseValue: number, count = 24) {
  const now = new Date();
  return Array.from({ length: count }, (_, i) => {
    const h = new Date(now);
    h.setHours(now.getHours() - (count - 1 - i), 0, 0, 0);
    const jitter = 1 + (Math.sin(i * 0.7) * 0.2);
    return { hour: h.toISOString(), value: Math.round(baseValue * jitter) };
  });
}

function daysAgoUnix(n: number) {
  return Math.floor((Date.now() - n * 86_400_000) / 1000);
}

// ---------------------------------------------------------------------------
// KPI
// ---------------------------------------------------------------------------

export const kpi: DashboardKPI = {
  successRate: { value: 97.3, delta: 1.2 },
  orchestratorsOnline: { value: 47, delta: 3 },
  dailyUsageMins: { value: 18_420, delta: 8.5 },
  dailySessionCount: { value: 2_341, delta: 5.2 },
  dailyNetworkFeesEth: { value: 0.0023, delta: -0.5 },
  timeframeHours: 24,
  hourlyUsage: hourlyBuckets(767),
  hourlySessions: hourlyBuckets(97),
};

// ---------------------------------------------------------------------------
// Pipelines
// ---------------------------------------------------------------------------

export const pipelines: DashboardPipelineUsage[] = [
  {
    name: 'live-video-to-video',
    mins: 8_210,
    sessions: 1_042,
    avgFps: 24.1,
    color: '#10b981',
    modelMins: [
      { model: 'streamdiffusion', mins: 5_100, sessions: 640, avgFps: 24.3 },
      { model: 'stable-video-diffusion', mins: 3_110, sessions: 402, avgFps: 23.8 },
    ],
  },
  {
    name: 'text-to-image',
    mins: 3_780,
    sessions: 620,
    avgFps: 0,
    color: '#f59e0b',
    modelMins: [
      { model: 'SG161222/RealVisXL_V4.0_Lightning', mins: 2_200, sessions: 360, avgFps: 0 },
      { model: 'ByteDance/SDXL-Lightning', mins: 1_580, sessions: 260, avgFps: 0 },
    ],
  },
  {
    name: 'image-to-video',
    mins: 2_940,
    sessions: 310,
    avgFps: 8.0,
    color: '#3b82f6',
    modelMins: [
      { model: 'stabilityai/stable-video-diffusion-img2vid-xt-1-1', mins: 2_940, sessions: 310, avgFps: 8.0 },
    ],
  },
  {
    name: 'llm',
    mins: 2_100,
    sessions: 280,
    avgFps: 0,
    color: '#8b5cf6',
    modelMins: [
      { model: 'meta-llama/Meta-Llama-3.1-8B-Instruct', mins: 1_400, sessions: 180, avgFps: 0 },
      { model: 'mistralai/Mistral-7B-Instruct-v0.3', mins: 700, sessions: 100, avgFps: 0 },
    ],
  },
  {
    name: 'audio-to-text',
    mins: 1_390,
    sessions: 89,
    avgFps: 0,
    color: '#06b6d4',
    modelMins: [
      { model: 'openai/whisper-large-v3', mins: 1_390, sessions: 89, avgFps: 0 },
    ],
  },
];

// ---------------------------------------------------------------------------
// Pipeline catalog
// ---------------------------------------------------------------------------

export const pipelineCatalog: DashboardPipelineCatalogEntry[] = [
  {
    id: 'live-video-to-video',
    name: 'Live Video-to-Video',
    models: ['streamdiffusion', 'stable-video-diffusion'],
    regions: ['fra1', 'nyc1', 'sfo3'],
  },
  {
    id: 'text-to-image',
    name: 'Text-to-Image',
    models: ['SG161222/RealVisXL_V4.0_Lightning', 'ByteDance/SDXL-Lightning', 'stabilityai/stable-diffusion-xl-base-1.0'],
    regions: ['fra1', 'nyc1', 'sfo3', 'sgp1'],
  },
  {
    id: 'image-to-video',
    name: 'Image-to-Video',
    models: ['stabilityai/stable-video-diffusion-img2vid-xt-1-1'],
    regions: ['fra1', 'nyc1'],
  },
  {
    id: 'image-to-image',
    name: 'Image-to-Image',
    models: ['timbrooks/instruct-pix2pix', 'ByteDance/SDXL-Lightning'],
    regions: ['fra1', 'nyc1', 'sfo3'],
  },
  {
    id: 'llm',
    name: 'LLM',
    models: ['meta-llama/Meta-Llama-3.1-8B-Instruct', 'mistralai/Mistral-7B-Instruct-v0.3'],
    regions: ['fra1', 'nyc1', 'sfo3'],
  },
  {
    id: 'audio-to-text',
    name: 'Audio-to-Text',
    models: ['openai/whisper-large-v3'],
    regions: ['fra1', 'nyc1', 'sfo3', 'sgp1'],
  },
  {
    id: 'upscale',
    name: 'Upscale',
    models: ['stabilityai/stable-diffusion-x4-upscaler'],
    regions: ['fra1', 'nyc1'],
  },
];

// ---------------------------------------------------------------------------
// Orchestrators
// ---------------------------------------------------------------------------

export const orchestrators: DashboardOrchestrator[] = [
  {
    address: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b',
    knownSessions: 512,
    successSessions: 498,
    successRatio: 0.973,
    effectiveSuccessRate: 0.971,
    noSwapRatio: 0.968,
    slaScore: 0.970,
    pipelines: ['live-video-to-video', 'text-to-image'],
    pipelineModels: [
      { pipelineId: 'live-video-to-video', modelIds: ['streamdiffusion'] },
      { pipelineId: 'text-to-image', modelIds: ['SG161222/RealVisXL_V4.0_Lightning'] },
    ],
    gpuCount: 4,
  },
  {
    address: '0x2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c',
    knownSessions: 388,
    successSessions: 379,
    successRatio: 0.977,
    effectiveSuccessRate: 0.975,
    noSwapRatio: 0.981,
    slaScore: 0.978,
    pipelines: ['text-to-image', 'llm'],
    pipelineModels: [
      { pipelineId: 'text-to-image', modelIds: ['ByteDance/SDXL-Lightning'] },
      { pipelineId: 'llm', modelIds: ['meta-llama/Meta-Llama-3.1-8B-Instruct'] },
    ],
    gpuCount: 3,
  },
  {
    address: '0x3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d',
    knownSessions: 271,
    successSessions: 260,
    successRatio: 0.959,
    effectiveSuccessRate: 0.955,
    noSwapRatio: 0.962,
    slaScore: 0.958,
    pipelines: ['audio-to-text', 'image-to-video'],
    pipelineModels: [
      { pipelineId: 'audio-to-text', modelIds: ['openai/whisper-large-v3'] },
      { pipelineId: 'image-to-video', modelIds: ['stabilityai/stable-video-diffusion-img2vid-xt-1-1'] },
    ],
    gpuCount: 2,
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
    dateS: daysAgoUnix(dayDataCount - i),
    volumeEth: parseFloat((Math.random() * 8 + 2).toFixed(4)),
    volumeUsd: Math.round(Math.random() * 25_000 + 5_000),
  })),
  weeklyData: Array.from({ length: 26 }, (_, i) => ({
    date: daysAgoUnix((26 - i) * 7),
    weeklyVolumeUsd: Math.round(Math.random() * 120_000 + 40_000),
    weeklyVolumeEth: parseFloat((Math.random() * 40 + 15).toFixed(4)),
  })),
};

// ---------------------------------------------------------------------------
// GPU capacity
// ---------------------------------------------------------------------------

export const gpuCapacity: DashboardGPUCapacity = {
  totalGPUs: 124,
  activeGPUs: 98,
  availableCapacity: 0.79,
  models: [
    { model: 'NVIDIA RTX 4090', count: 48 },
    { model: 'NVIDIA RTX 3090', count: 36 },
    { model: 'NVIDIA A100', count: 24 },
    { model: 'NVIDIA RTX 4080', count: 16 },
  ],
  pipelineGPUs: [
    {
      name: 'live-video-to-video',
      gpus: 52,
      models: [
        { model: 'NVIDIA RTX 4090', gpus: 28 },
        { model: 'NVIDIA RTX 3090', gpus: 24 },
      ],
    },
    {
      name: 'text-to-image',
      gpus: 34,
      models: [
        { model: 'NVIDIA RTX 4090', gpus: 14 },
        { model: 'NVIDIA RTX 3090', gpus: 12 },
        { model: 'NVIDIA RTX 4080', gpus: 8 },
      ],
    },
    {
      name: 'llm',
      gpus: 24,
      models: [
        { model: 'NVIDIA A100', gpus: 24 },
      ],
    },
    {
      name: 'audio-to-text',
      gpus: 14,
      models: [
        { model: 'NVIDIA RTX 3090', gpus: 8 },
        { model: 'NVIDIA RTX 4080', gpus: 6 },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

export const pricing: DashboardPipelinePricing[] = [
  { pipeline: 'live-video-to-video', unit: 'pixel', price: 0.000_002_1, pixelsPerUnit: 1, outputPerDollar: '~476M px/s' },
  { pipeline: 'text-to-image', unit: 'pixel', price: 0.000_001_8, pixelsPerUnit: 1, outputPerDollar: '~556M px' },
  { pipeline: 'image-to-video', unit: 'pixel', price: 0.000_003_4, pixelsPerUnit: 1, outputPerDollar: '~294M px' },
  { pipeline: 'image-to-image', unit: 'pixel', price: 0.000_001_6, pixelsPerUnit: 1, outputPerDollar: '~625M px' },
  { pipeline: 'llm', unit: 'token', price: 0.000_000_8, pixelsPerUnit: null, outputPerDollar: '~1.25M tokens' },
  { pipeline: 'audio-to-text', unit: 'second', price: 0.000_05, pixelsPerUnit: null, outputPerDollar: '~20K seconds' },
  { pipeline: 'upscale', unit: 'pixel', price: 0.000_002_5, pixelsPerUnit: 1, outputPerDollar: '~400M px' },
];

// ---------------------------------------------------------------------------
// Job feed
// ---------------------------------------------------------------------------

export const jobFeed: JobFeedItem[] = [
  {
    id: 'stream-a1b2c3d4',
    pipeline: 'live-video-to-video',
    gateway: 'gateway.livepeer.cloud',
    orchestratorUrl: 'https://orch-1.example.com',
    state: 'running',
    inputFps: 30,
    outputFps: 24.1,
    firstSeen: new Date(Date.now() - 142_000).toISOString(),
    lastSeen: new Date(Date.now() - 1_000).toISOString(),
    durationSeconds: 142,
    runningFor: '2m 22s',
  },
  {
    id: 'stream-b2c3d4e5',
    pipeline: 'live-video-to-video',
    gateway: 'gateway.livepeer.cloud',
    orchestratorUrl: 'https://orch-2.example.com',
    state: 'running',
    inputFps: 30,
    outputFps: 23.8,
    firstSeen: new Date(Date.now() - 67_000).toISOString(),
    lastSeen: new Date(Date.now() - 1_000).toISOString(),
    durationSeconds: 67,
    runningFor: '1m 7s',
  },
  {
    id: 'stream-c3d4e5f6',
    pipeline: 'text-to-image',
    gateway: 'gateway2.livepeer.cloud',
    orchestratorUrl: 'https://orch-3.example.com',
    state: 'running',
    inputFps: 0,
    outputFps: 0,
    firstSeen: new Date(Date.now() - 23_000).toISOString(),
    lastSeen: new Date(Date.now() - 1_000).toISOString(),
    durationSeconds: 23,
    runningFor: '23s',
  },
  {
    id: 'stream-d4e5f6a7',
    pipeline: 'audio-to-text',
    gateway: 'gateway.livepeer.cloud',
    orchestratorUrl: 'https://orch-1.example.com',
    state: 'running',
    inputFps: 0,
    outputFps: 0,
    firstSeen: new Date(Date.now() - 310_000).toISOString(),
    lastSeen: new Date(Date.now() - 1_000).toISOString(),
    durationSeconds: 310,
    runningFor: '5m 10s',
  },
  {
    id: 'stream-e5f6a7b8',
    pipeline: 'live-video-to-video',
    gateway: 'gateway3.livepeer.cloud',
    orchestratorUrl: 'https://orch-4.example.com',
    state: 'degraded_inference',
    inputFps: 30,
    outputFps: 12.3,
    firstSeen: new Date(Date.now() - 88_000).toISOString(),
    lastSeen: new Date(Date.now() - 1_000).toISOString(),
    durationSeconds: 88,
    runningFor: '1m 28s',
  },
];

// ---------------------------------------------------------------------------
// Network models
// ---------------------------------------------------------------------------

export const networkModels: NetworkModel[] = [
  { Pipeline: 'live-video-to-video', Model: 'streamdiffusion', WarmOrchCount: 18, TotalCapacity: 52, PriceMinWeiPerPixel: 1_800_000, PriceMaxWeiPerPixel: 2_400_000, PriceAvgWeiPerPixel: 2_100_000 },
  { Pipeline: 'live-video-to-video', Model: 'stable-video-diffusion', WarmOrchCount: 12, TotalCapacity: 34, PriceMinWeiPerPixel: 1_900_000, PriceMaxWeiPerPixel: 2_600_000, PriceAvgWeiPerPixel: 2_250_000 },
  { Pipeline: 'text-to-image', Model: 'SG161222/RealVisXL_V4.0_Lightning', WarmOrchCount: 22, TotalCapacity: 64, PriceMinWeiPerPixel: 1_500_000, PriceMaxWeiPerPixel: 2_000_000, PriceAvgWeiPerPixel: 1_750_000 },
  { Pipeline: 'text-to-image', Model: 'ByteDance/SDXL-Lightning', WarmOrchCount: 19, TotalCapacity: 56, PriceMinWeiPerPixel: 1_400_000, PriceMaxWeiPerPixel: 1_900_000, PriceAvgWeiPerPixel: 1_650_000 },
  { Pipeline: 'text-to-image', Model: 'stabilityai/stable-diffusion-xl-base-1.0', WarmOrchCount: 14, TotalCapacity: 42, PriceMinWeiPerPixel: 1_600_000, PriceMaxWeiPerPixel: 2_100_000, PriceAvgWeiPerPixel: 1_850_000 },
  { Pipeline: 'image-to-video', Model: 'stabilityai/stable-video-diffusion-img2vid-xt-1-1', WarmOrchCount: 11, TotalCapacity: 30, PriceMinWeiPerPixel: 3_000_000, PriceMaxWeiPerPixel: 3_800_000, PriceAvgWeiPerPixel: 3_400_000 },
  { Pipeline: 'image-to-image', Model: 'timbrooks/instruct-pix2pix', WarmOrchCount: 9, TotalCapacity: 26, PriceMinWeiPerPixel: 1_400_000, PriceMaxWeiPerPixel: 1_900_000, PriceAvgWeiPerPixel: 1_620_000 },
  { Pipeline: 'llm', Model: 'meta-llama/Meta-Llama-3.1-8B-Instruct', WarmOrchCount: 15, TotalCapacity: 42, PriceMinWeiPerPixel: 700_000, PriceMaxWeiPerPixel: 900_000, PriceAvgWeiPerPixel: 800_000 },
  { Pipeline: 'llm', Model: 'mistralai/Mistral-7B-Instruct-v0.3', WarmOrchCount: 10, TotalCapacity: 28, PriceMinWeiPerPixel: 650_000, PriceMaxWeiPerPixel: 850_000, PriceAvgWeiPerPixel: 750_000 },
  { Pipeline: 'audio-to-text', Model: 'openai/whisper-large-v3', WarmOrchCount: 16, TotalCapacity: 44, PriceMinWeiPerPixel: 40_000, PriceMaxWeiPerPixel: 60_000, PriceAvgWeiPerPixel: 50_000 },
];
