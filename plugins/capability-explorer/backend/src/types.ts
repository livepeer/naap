import { z } from 'zod';

// ---------------------------------------------------------------------------
// Capability Categories
// ---------------------------------------------------------------------------

export const CAPABILITY_CATEGORIES = [
  'llm', 't2i', 't2v', 'i2i', 'i2v',
  'a2t', 'tts', 'upscale', 'live-video', 'other',
] as const;

export type CapabilityCategory = (typeof CAPABILITY_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<CapabilityCategory, string> = {
  llm: 'LLM',
  t2i: 'Text to Image',
  t2v: 'Text to Video',
  i2i: 'Image to Image',
  i2v: 'Image to Video',
  a2t: 'Audio to Text',
  tts: 'Text to Speech',
  upscale: 'Upscale',
  'live-video': 'Live Video',
  other: 'Other',
};

export const CATEGORY_ICONS: Record<CapabilityCategory, string> = {
  llm: 'MessageSquare',
  t2i: 'Image',
  t2v: 'Film',
  i2i: 'Paintbrush',
  i2v: 'Video',
  a2t: 'Mic',
  tts: 'Volume2',
  upscale: 'Maximize2',
  'live-video': 'Radio',
  other: 'Layers',
};

/**
 * Maps pipeline names from go-livepeer to capability categories.
 */
export const PIPELINE_TO_CATEGORY: Record<string, CapabilityCategory> = {
  'text-to-image': 't2i',
  'image-to-image': 'i2i',
  'image-to-video': 'i2v',
  'text-to-video': 't2v',
  'upscale': 'upscale',
  'audio-to-text': 'a2t',
  'segment-anything-2': 'other',
  'llm': 'llm',
  'image-to-text': 'other',
  'live-video-to-video': 'live-video',
  'text-to-speech': 'tts',
  'openai-chat-completions': 'llm',
  'openai-image-generation': 't2i',
  'openai-text-embeddings': 'llm',
};

// ---------------------------------------------------------------------------
// SDK Snippet
// ---------------------------------------------------------------------------

export interface SdkSnippet {
  curl: string;
  python: string;
  javascript: string;
}

// ---------------------------------------------------------------------------
// Enriched Model
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Enriched Capability
// ---------------------------------------------------------------------------

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
  bestLatencyMs: number | null;
  avgFps: number | null;

  meanPriceUsd: number | null;
  minPriceUsd: number | null;
  maxPriceUsd: number | null;
  priceUnit: string;

  sdkSnippet: SdkSnippet;
  models: EnrichedModel[];
  lastUpdated: string;

  /** Transient: orchestrator URIs used during merge for deduplication. Stripped before persistence. */
  _orchestratorUris?: string[];
}

// ---------------------------------------------------------------------------
// API Request/Response
// ---------------------------------------------------------------------------

export const SORT_FIELDS = ['name', 'gpuCount', 'price', 'latency', 'capacity'] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export const SORT_ORDERS = ['asc', 'desc'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

export const ListCapabilitiesParamsSchema = z.object({
  category: z.enum(CAPABILITY_CATEGORIES).optional(),
  search: z.string().max(200).optional(),
  minGpuCount: z.coerce.number().int().min(0).optional(),
  maxPriceUsd: z.coerce.number().min(0).optional(),
  minCapacity: z.coerce.number().int().min(0).optional(),
  sortBy: z.enum(SORT_FIELDS).optional(),
  sortOrder: z.enum(SORT_ORDERS).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ListCapabilitiesParams = z.infer<typeof ListCapabilitiesParamsSchema>;

export interface CapabilityConnection {
  items: EnrichedCapability[];
  total: number;
  hasMore: boolean;
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

// ---------------------------------------------------------------------------
// ClickHouse Row Types
// ---------------------------------------------------------------------------

export interface ClickHouseCapabilityRow {
  capability_name: string;
  orch_uri: string;
  gpu_name: string;
  gpu_gb: number;
  avail: number;
  total_cap: number;
  price_per_unit: number;
}

export interface ClickHouseLatencyRow {
  orchestrator_url: string;
  avg_latency: number | null;
  best_latency: number | null;
}

export interface ClickHouseCapabilitySummary {
  capability_name: string;
  pipeline_type: string;
  orchestrators: number;
  gpus: number;
  total_slots: number;
  used_slots: number;
  free_slots: number;
  free_pct: number;
  mean_price_per_pixel_wei: number;
  min_price_per_pixel_wei: number;
  max_price_per_pixel_wei: number;
  avg_latency_ms: number | null;
}

export interface ClickHouseJSONResponse<T = unknown> {
  meta: Array<{ name: string; type: string }>;
  data: T[];
  rows: number;
  statistics: { elapsed: number; rows_read: number; bytes_read: number };
}

// ---------------------------------------------------------------------------
// HuggingFace Model Card
// ---------------------------------------------------------------------------

export interface HFModelCard {
  _id: string;
  modelId: string;
  author: string;
  sha: string;
  lastModified: string;
  tags: string[];
  pipeline_tag: string | null;
  library_name: string | null;
  cardData?: {
    license?: string;
    tags?: string[];
    thumbnail?: string;
  };
  description?: string;
  downloads: number;
  likes: number;
}

// ---------------------------------------------------------------------------
// Cache Entry
// ---------------------------------------------------------------------------

export interface CacheEntry<T> {
  data: T;
  cachedAt: number;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Capability Query (user-scoped saved filter, mirrors DiscoveryPlan)
// ---------------------------------------------------------------------------

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

export const CreateCapabilityQuerySchema = z.object({
  name: z.string().min(1).max(100),
  slug: z.string().min(1).max(100).regex(/^[a-z0-9-]+$/),
  category: z.string().optional(),
  search: z.string().max(200).optional(),
  minGpuCount: z.number().int().min(0).optional(),
  maxPriceUsd: z.number().min(0).optional(),
  minCapacity: z.number().int().min(0).optional(),
  sortBy: z.enum(SORT_FIELDS).optional(),
  sortOrder: z.enum(SORT_ORDERS).optional(),
  limit: z.number().int().min(1).max(100).default(50),
});

export type CreateCapabilityQueryInput = z.infer<typeof CreateCapabilityQuerySchema>;

export const UpdateCapabilityQuerySchema = z.object({
  name: z.string().min(1).max(100).optional(),
  category: z.string().optional().nullable(),
  search: z.string().max(200).optional().nullable(),
  minGpuCount: z.number().int().min(0).optional().nullable(),
  maxPriceUsd: z.number().min(0).optional().nullable(),
  minCapacity: z.number().int().min(0).optional().nullable(),
  sortBy: z.enum(SORT_FIELDS).optional().nullable(),
  sortOrder: z.enum(SORT_ORDERS).optional().nullable(),
  limit: z.number().int().min(1).max(100).optional(),
  enabled: z.boolean().optional(),
});

export type UpdateCapabilityQueryInput = z.infer<typeof UpdateCapabilityQuerySchema>;

// ---------------------------------------------------------------------------
// Admin Config Types
// ---------------------------------------------------------------------------

export interface CapabilityExplorerConfigRecord {
  id: string;
  refreshIntervalHours: number;
  enabledSources: Record<string, boolean>;
  refreshIntervals: Record<string, number>;
  lastRefreshAt: string | null;
  lastRefreshStatus: string | null;
  updatedAt: string;
}

export const UpdateConfigSchema = z.object({
  refreshIntervalHours: z.number().int().min(1).max(24).optional(),
  enabledSources: z.record(z.boolean()).optional(),
  refreshIntervals: z.record(z.number().int().min(1).max(48)).optional(),
});

export type UpdateConfigInput = z.infer<typeof UpdateConfigSchema>;

// ---------------------------------------------------------------------------
// Handler Context (passed from thin route stubs)
// ---------------------------------------------------------------------------

export interface HandlerContext {
  authToken: string;
  requestUrl: string;
  cookieHeader?: string | null;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}
