import type { CapacityRequest, SoftCommit, RequestComment } from '@naap/types';

export type { CapacityRequest, SoftCommit, RequestComment };

export type SortField = 'newest' | 'gpuCount' | 'hourlyRate' | 'riskLevel' | 'mostCommits' | 'deadline';
export type SortDirection = 'asc' | 'desc';

export interface FilterState {
  search: string;
  gpuModel: string;
  vramMin: string;
  pipeline: string;
}

export interface SummaryData {
  totalRequests: number;
  totalGPUsNeeded: number;
  mostDesiredGPU: { model: string; count: number } | null;
  mostPopularPipeline: { name: string; count: number } | null;
  topRequestor: { name: string; count: number } | null;
  avgHourlyRate: number;
}

export interface NewRequestFormData {
  requesterName: string;
  gpuModel: string;
  vram: string;
  osVersion: string;
  cudaVersion: string;
  count: string;
  pipeline: string;
  startDate: string;
  endDate: string;
  validUntil: string;
  hourlyRate: string;
  reason: string;
  riskLevel: 1 | 2 | 3 | 4 | 5;
}

export const GPU_MODELS = [
  'RTX 4090',
  'RTX 4080',
  'RTX 3090',
  'RTX 3080',
  'A100 40GB',
  'A100 80GB',
  'H100',
  'H200',
  'L40S',
  'A10G',
  'V100',
  'T4',
];

export const VRAM_OPTIONS = ['8', '12', '16', '24', '40', '48', '80'];

export const CUDA_VERSIONS = ['11.8', '12.0', '12.1', '12.2', '12.3', '12.4', '12.5'];

export const OS_OPTIONS = ['Ubuntu 22.04', 'Ubuntu 20.04', 'Ubuntu 24.04', 'Debian 12', 'RHEL 9', 'Any'];

export const PIPELINE_OPTIONS = [
  'text-to-image',
  'image-to-image',
  'image-to-video',
  'text-to-video',
  'audio-to-text',
  'llm',
  'live-video-to-video',
  'segment-anything-2',
  'upscale',
  'text-to-speech',
  'object-detection',
];

export const RISK_LABELS: Record<number, { label: string; color: string }> = {
  1: { label: 'Very Low', color: 'text-text-secondary' },
  2: { label: 'Low', color: 'text-accent-blue' },
  3: { label: 'Medium', color: 'text-accent-amber' },
  4: { label: 'High', color: 'text-accent-amber' },
  5: { label: 'Very High', color: 'text-accent-rose' },
};
