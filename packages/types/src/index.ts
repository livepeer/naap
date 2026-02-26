// @naap/types - Shared type definitions for the Livepeer Network Monitor

export interface Gateway {
  id: string;
  address: string;
  operatorName: string;
  serviceUri: string;
  region: string;
  ip: string;
  status: "online" | "offline" | "degraded";
  uptime: number;
  latencyP50: number;
  latencyP99: number;
  jobsPerMinute: number;
  deposit: number;
  reserve: number;
  supportedPipelines: string[];
  capacityByPipeline: Record<string, { current: number; desired: number; gap: number }>;
  connectedOrchestrators: number;
  version: string;
}

export interface Orchestrator {
  id: string;
  address: string;
  operatorName: string;
  serviceUri: string;
  region: string;
  gpuType: string;
  gpuCount: number;
  vram: number;
  cudaVersion: string;
  memoryBandwidth: string;
  interconnects: string;
  status: "active" | "suspended" | "updating";
  currentLoad: number;
  maxCapacity: number;
  successRate: number;
  latencyScore: number;
  pricePerUnit: Record<string, number>;
  supportedPipelines: string[];
  earningsToday: number;
  ticketsWon: number;
  ticketsPending: number;
  aiWorkers: AIWorker[];
  version: string;
}

export interface AIWorker {
  id: string;
  pipeline: string;
  modelId: string;
  containerStatus: "creating" | "running" | "idle" | "stopped" | "error";
  gpuId: string;
  lastJobTime: string;
  jobsProcessed: number;
}

export type JobType = "text-to-image" | "image-to-image" | "audio-to-text" | "llm" | "live-video-to-video" | "segment-anything-2" | "upscale" | "image-to-video";

export interface Job {
  id: string;
  type: JobType;
  gatewayId: string;
  orchestratorId: string;
  status: "processing" | "completed" | "failed";
  latencyMs: number;
  priceWei: number;
  timestamp: string;
}

export interface Ticket {
  id: string;
  sender: string;
  recipient: string;
  faceValue: number;
  status: "created" | "sent" | "won" | "redeemed";
  createdAt: string;
}

export interface NetworkStats {
  healthScore: number;
  activeJobsNow: number;
  gatewaysOnline: number;
  orchestratorsOnline: number;
  totalValueLocked: number;
  feesThisRound: number;
  currentRound: number;
  nextRoundIn: number;
}

export interface Capability {
  pipeline: string;
  displayName: string;
  icon: string;
  orchestratorCount: number;
  avgPriceMin: number;
  avgPriceMax: number;
  networkCapacity: number;
  demandLevel: "low" | "medium" | "high";
}

export interface CapacityRequest {
  id: string;
  /** Who initiated - user description input (displayed as title) */
  requesterName: string;
  /** Account/wallet name (displayed below title) */
  requesterAccount: string;
  /** GPU model name */
  gpuModel: string;
  /** VRAM in GB */
  vram: number;
  /** OS version requirement */
  osVersion: string;
  /** CUDA version requirement */
  cudaVersion: string;
  /** Number of GPUs needed */
  count: number;
  /** Pipeline / workflow name */
  pipeline: string;
  /** When the capacity is needed from */
  startDate: string;
  /** When the capacity is needed until */
  endDate: string;
  /** Request auto-expires after this date (off-shelf) */
  validUntil: string;
  /** Desired hourly rate in USD */
  hourlyRate: number;
  /** Reason for asking */
  reason: string;
  /** Risk level 1-5 (5 = highest possibility this demand materializes) */
  riskLevel: 1 | 2 | 3 | 4 | 5;
  /** Soft commitments (thumb-ups) */
  softCommits: SoftCommit[];
  /** Questions and comments thread */
  comments: RequestComment[];
  /** ISO timestamp of creation */
  createdAt: string;
  /** Request status */
  status: 'active' | 'expired' | 'fulfilled';

  // Legacy compat fields (optional)
  gatewayName?: string;
  gatewayId?: string;
  gpuType?: string;
  workflow?: string;
  deadline?: string;
  feasibilityData?: string;
  hasCommitted?: boolean;
}

export interface SoftCommit {
  id: string;
  userId: string;
  userName: string;
  timestamp: string;
}

export interface RequestComment {
  id: string;
  author: string;
  text: string;
  timestamp: string;
}

export interface ForumPost {
  id: string;
  author: string;
  title: string;
  content: string;
  tags: string[];
  upvotes: number;
  commentCount: number;
  createdAt: string;
  category: "General" | "Infrastructure" | "Governance" | "AI Workloads";
}

export interface MarketplaceAsset {
  id: string;
  name: string;
  description: string;
  category: "App" | "Pipeline";
  icon: string;
  author: string;
  status: "Active" | "Beta" | "Experimental";
  stats?: string;
  tags: string[];
}

export interface ForumComment {
  id: string;
  author: string;
  content: string;
  createdAt: string;
  upvotes: number;
}

// Shell Context types for MFE communication
export interface UserContext {
  address: string | null;
  isConnected: boolean;
  displayName?: string;
}

export interface ThemeTokens {
  isDark: boolean;
  colors: {
    primary: string;
    secondary: string;
    accent: string;
    background: string;
    text: string;
  };
}

// Developer API Manager types
export type AIModelType = 'text-to-video' | 'image-to-video' | 'video-to-video';

export interface GPUHardwareSummary {
  name: string;          // "NVIDIA GeForce RTX 5090"
  count: number;         // distinct gpu_id count
  memoryGB: number;      // gpu_memory_total / 1e9, rounded
  avgFPS: number;
  p95FPS: number;
  avgLatencyMs: number | null;
  failureRate: number;   // 0-1
}

export interface NetworkModel {
  id: string;                  // "{pipelineId}::{modelId}"
  pipelineId: string;          // "live-video-to-video"
  pipelineType: string;        // "Video-to-Video" (display name)
  modelId: string;             // "streamdiffusion-sdxl"
  displayName: string;         // "SDXL StreamDiffusion"
  regions: string[];           // display names: ["Frankfurt", "Chicago", "Seattle"]
  regionCodes: string[];       // ["FRA", "MDW", "SEA"]
  gpuHardware: GPUHardwareSummary[];
  orchestratorCount: number;
  avgFPS: number;
  e2eLatencyMs: number | null;
  slaScore: number | null;     // 0-1
  isRealtime: boolean;
  gatewayOffers?: GatewayOffer[];
}

export interface AIModel {
  id: string;
  name: string;
  tagline: string;
  type: AIModelType;
  featured: boolean;
  realtime: boolean;
  costPerMin: { min: number; max: number };
  latencyP50: number;
  coldStart: number;
  fps: number;
  useCases: string[];
  badges: string[];
}

export type SLATier = 'bronze' | 'silver' | 'gold';
export type CapacityLevel = 'low' | 'medium' | 'high';

export interface NetworkDemandSummary {
  gatewayId: string;
  gatewayName: string;
  pipeline: string;
  regions: string[];
  totalSessions: number;
  servedSessions: number;
  missingCapacityCount: number;
  successRatio: number;
  totalInferenceMinutes: number;
  feePaymentEth: number;
  demandLevel: CapacityLevel;
}

export interface GatewayOffer {
  gatewayId: string;
  gatewayName: string;
  slaTier: SLATier;
  uptimeGuarantee: number;
  latencyGuarantee: number;
  unitPrice: number;
  regions: string[];
  capacity: CapacityLevel;
}
export type ApiKeyStatus = 'active' | 'revoked';

export interface DeveloperApiKey {
  id: string;
  projectName: string;
  providerDisplayName: string;
  keyHash: string;
  status: ApiKeyStatus;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface UsageRecord {
  keyId: string;
  date: string;
  sessions: number;
  outputMinutes: number;
  estimatedCost: number;
}

export interface Invoice {
  id: string;
  date: string;
  amount: number;
  status: 'paid' | 'pending' | 'overdue';
}

export interface BillingPeriod {
  startDate: string;
  endDate: string;
  totalSessions: number;
  totalOutputMinutes: number;
  estimatedCost: number;
  invoices: Invoice[];
}

// Re-export canonical user types
export type { AuthUser, User } from './user';

// Re-export manifest types (legacy - for MFE workflow compatibility)
export * from './manifest';

// Re-export unified plugin types
export * from './plugin';
// Explicitly export runtime values that may not be properly re-exported via export *
export { PLUGIN_CATEGORIES, RESERVED_PLUGIN_NAMES, isReservedPluginName } from './plugin';

// Re-export error types
export * from './errors';

// Re-export shared API response types and error codes
export * from './api-response';

// Re-export transformer utilities
export * from './transformers';

// Re-export debug console types
export * from './debug';

// Re-export shared HTTP header constants (used by plugin-sdk & plugin-server-sdk)
export * from './http-headers';
