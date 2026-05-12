export type CapabilityCategory =
  | 'llm' | 't2i' | 't2v' | 'i2i' | 'i2v'
  | 'a2t' | 'tts' | 'upscale' | 'live-video' | 'other';

export interface SdkSnippet {
  curl: string;
  python: string;
  javascript: string;
}

export interface EnrichedModel {
  modelId: string;
  name: string;
  warm: boolean;
  huggingFaceUrl: string | null;
  description: string | null;
  avgFps: number | null;
  gpuCount: number;
  meanPriceUsd: number | null;
}

export interface EnrichedCapability {
  id: string;
  name: string;
  category: CapabilityCategory;
  source: string;
  version: string;
  description: string;
  modelSourceUrl: string;
  thumbnail: string | null;
  license: string | null;
  tags: string[];
  gpuCount: number;
  totalCapacity: number;
  orchestratorCount: number;
  avgLatencyMs: number | null;
  avgFps: number | null;
  meanPriceUsd: number | null;
  minPriceUsd: number | null;
  maxPriceUsd: number | null;
  priceUnit: string;
  sdkSnippet: SdkSnippet;
  models: EnrichedModel[];
  lastUpdated: string;
}

export interface CategoryInfo {
  id: CapabilityCategory;
  label: string;
  count: number;
  icon: string;
}

export interface ExplorerStats {
  totalCapabilities: number;
  totalModels: number;
  totalGpus: number;
  totalOrchestrators: number;
  avgPriceUsd: number | null;
}

export interface CapabilityConnection {
  items: EnrichedCapability[];
  total: number;
  hasMore: boolean;
}

export type SortField = 'name' | 'gpuCount' | 'price' | 'latency' | 'capacity';
export type SortOrder = 'asc' | 'desc';
export type ViewMode = 'grid' | 'list';

export interface CapabilityQueryRecord {
  id: string;
  name: string;
  slug: string;
  teamId: string | null;
  ownerUserId: string | null;
  category: string | null;
  search: string | null;
  minGpuCount: number | null;
  maxPriceUsd: number | null;
  minCapacity: number | null;
  sortBy: string | null;
  sortOrder: string | null;
  limit: number;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface DataSourceInfo {
  id: string;
  name: string;
  type: 'core' | 'enrichment';
  enabled: boolean;
  lastSnapshotAt: string | null;
  lastSnapshotStatus: string | null;
}

export interface ExplorerConfig {
  id: string;
  refreshIntervalHours: number;
  enabledSources: Record<string, boolean>;
  refreshIntervals: Record<string, number>;
  lastRefreshAt: string | null;
  lastRefreshStatus: string | null;
  updatedAt: string;
}

export interface SnapshotRecord {
  id: string;
  sourceId: string;
  status: string;
  errorMessage: string | null;
  durationMs: number;
  createdAt: string;
}
