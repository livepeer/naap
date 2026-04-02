/**
 * Dashboard Data Provider Contracts
 *
 * Defines the GraphQL schema, event bus constants, and TypeScript types
 * that form the contract between the core dashboard and any plugin that
 * provides dashboard data.
 *
 * The core dashboard sends GraphQL query strings via the event bus.
 * Any plugin that registers as a handler executes the query against
 * the shared schema and returns the result.
 *
 * @example
 * ```typescript
 * // Core (consumer) — sends a query
 * const result = await eventBus.request(DASHBOARD_QUERY_EVENT, {
 *   query: '{ kpi { successRate { value delta } } }',
 * });
 *
 * // Plugin (provider) — handles the query
 * eventBus.handleRequest(DASHBOARD_QUERY_EVENT, async ({ query }) => {
 *   return graphql({ schema, source: query, rootValue: resolvers });
 * });
 * ```
 */

// ============================================================================
// Well-Known Event Names
// ============================================================================

/** Event name for dashboard GraphQL queries (request/response) */
export const DASHBOARD_QUERY_EVENT = 'dashboard:query' as const;

/** Event name for subscribing to the live job feed stream */
export const DASHBOARD_JOB_FEED_EVENT = 'dashboard:job-feed:subscribe' as const;

/** Event name for job feed entries emitted via event bus (local/dev fallback) */
export const DASHBOARD_JOB_FEED_EMIT_EVENT = 'dashboard:job-feed:event' as const;

// ============================================================================
// GraphQL Schema (the contract)
// ============================================================================

/**
 * The shared GraphQL schema that defines all dashboard widget data types.
 *
 * Design principles:
 * - All root Query fields are nullable so partial providers work
 * - Each widget maps to one root field
 * - Types are flat and simple — no deep nesting
 * - Adding a new widget = adding a new root field + type
 */
export const DASHBOARD_SCHEMA = /* GraphQL */ `
  type Query {
    # Optimized/summary queries
    kpi(window: String, timeframe: String): KPI
    protocol: Protocol
    fees(days: Int): FeesInfo
    pipelines(limit: Int, timeframe: String): [PipelineUsage!]
    pipelineCatalog: [PipelineCatalogEntry!]
    gpuCapacity(timeframe: String): GPUCapacity
    pricing: [PipelinePricing!]
    orchestrators(period: String): [OrchestratorRow!]
  }

  type HourlyBucket {
    hour: String!
    value: Float!
  }

  type KPI {
    successRate: MetricDelta!
    orchestratorsOnline: MetricDelta!
    dailyUsageMins: MetricDelta!
    dailySessionCount: MetricDelta!
    dailyNetworkFeesEth: MetricDelta!
    timeframeHours: Int!
    hourlyUsage: [HourlyBucket!]
    hourlySessions: [HourlyBucket!]
  }

  type MetricDelta {
    value: Float!
    delta: Float!
  }

  type Protocol {
    currentRound: Int!
    blockProgress: Int!
    totalBlocks: Int!
    totalStakedLPT: Float!
  }

  type FeesInfo {
    totalEth: Float!
    totalUsd: Float!
    oneDayVolumeUsd: Float!
    oneDayVolumeEth: Float!
    oneWeekVolumeUsd: Float!
    oneWeekVolumeEth: Float!
    volumeChangeUsd: Float
    volumeChangeEth: Float
    weeklyVolumeChangeUsd: Float
    weeklyVolumeChangeEth: Float
    dayData: [FeeDayData!]!
    weeklyData: [FeeWeeklyData!]!
  }

  type FeeDayData {
    dateS: Int!
    volumeEth: Float!
    volumeUsd: Float!
  }

  type FeeWeeklyData {
    date: Int!
    weeklyVolumeUsd: Float!
    weeklyVolumeEth: Float!
  }

  type PipelineModelMins {
    model: String!
    mins: Float!
    sessions: Int!
    avgFps: Float!
  }

  type PipelineUsage {
    name: String!
    mins: Float!
    sessions: Int!
    avgFps: Float!
    color: String
    modelMins: [PipelineModelMins!]
  }

  type PipelineCatalogEntry {
    id: String!
    name: String!
    models: [String!]!
    regions: [String!]!
  }

  type GPUModelCapacity {
    model: String!
    count: Int!
  }

  type GPUCapacityPipelineModel {
    model: String!
    gpus: Int!
  }

  type GPUCapacityPipeline {
    name: String!
    gpus: Int!
    models: [GPUCapacityPipelineModel!]
  }

  type GPUCapacity {
    totalGPUs: Int!
    activeGPUs: Int!
    availableCapacity: Float!
    models: [GPUModelCapacity!]!
    pipelineGPUs: [GPUCapacityPipeline!]!
  }

  type PipelinePricing {
    pipeline: String!
    """Model name within the pipeline (e.g. "stabilityai/stable-diffusion-xl-base-1.0")."""
    model: String
    unit: String!
    price: Float!
    """Average pixelsPerUnit for this capability (billing step size in pixels)."""
    pixelsPerUnit: Float
    outputPerDollar: String!
    """Total capacity (warm + cold orchestrators) for this pipeline+model from /net/models."""
    capacity: Int
  }

  type PipelineModelOffer {
    pipelineId: String!
    modelIds: [String!]!
  }

  type OrchestratorRow {
    address: String!
    uri: String
    knownSessions: Int!
    successSessions: Int!
    successRatio: Float!
    effectiveSuccessRate: Float
    noSwapRatio: Float
    slaScore: Float
    pipelines: [String!]!
    pipelineModels: [PipelineModelOffer!]!
    gpuCount: Int!
  }
`;

// ============================================================================
// TypeScript Types (mirror the GraphQL types for compile-time safety)
// ============================================================================

/** A metric value with a comparison delta */
export interface MetricDelta {
  value: number;
  delta: number;
}

export interface HourlyBucket {
  hour: string;
  value: number;
}

/** KPI widget data */
export interface DashboardKPI {
  successRate: MetricDelta;
  orchestratorsOnline: MetricDelta;
  dailyUsageMins: MetricDelta;
  dailySessionCount: MetricDelta;
  dailyNetworkFeesEth: MetricDelta;
  /** The timeframe in hours that this KPI data covers */
  timeframeHours: number;
  hourlyUsage?: HourlyBucket[];
  hourlySessions?: HourlyBucket[];
}

/** Protocol widget data */
export interface DashboardProtocol {
  currentRound: number;
  blockProgress: number;
  totalBlocks: number;
  totalStakedLPT: number;
}

/** Single daily fee datapoint */
export interface DashboardFeeDayData {
  dateS: number;
  volumeEth: number;
  volumeUsd: number;
}

/** Single weekly fee datapoint */
export interface DashboardFeeWeeklyData {
  date: number;
  weeklyVolumeUsd: number;
  weeklyVolumeEth: number;
}

/** Fees widget data */
export interface DashboardFeesInfo {
  totalEth: number;
  totalUsd: number;
  oneDayVolumeUsd: number;
  oneDayVolumeEth: number;
  oneWeekVolumeUsd: number;
  oneWeekVolumeEth: number;
  volumeChangeUsd: number | null;
  volumeChangeEth: number | null;
  weeklyVolumeChangeUsd: number | null;
  weeklyVolumeChangeEth: number | null;
  dayData: DashboardFeeDayData[];
  weeklyData: DashboardFeeWeeklyData[];
}

/** Pipeline usage entry */
export interface DashboardPipelineModelMins {
  model: string;
  /** Minutes of demand for this model (from Network Demand, always 24h) */
  mins: number;
  /** Session count for this model (from Network Demand, always 24h) */
  sessions: number;
  /** Weighted average output FPS for this model (from Network Demand, always 24h) */
  avgFps: number;
  /** @deprecated GPU counts moved to GPUCapacity.pipelineGPUs */
  gpus?: number;
}

export interface DashboardPipelineUsage {
  name: string;
  /** Minutes of demand for this pipeline (from Network Demand, always 24h) */
  mins: number;
  /** Session count for this pipeline (from Network Demand, always 24h) */
  sessions: number;
  /** Weighted average output FPS for this pipeline (from Network Demand, always 24h) */
  avgFps: number;
  /** @deprecated GPU counts moved to GPUCapacity.pipelineGPUs */
  gpus?: number;
  color?: string;
  /** Per-model minute breakdown (when available) */
  modelMins?: DashboardPipelineModelMins[];
}

/** Pipeline catalog entry from /api/pipelines — all supported pipelines/models on the network */
export interface DashboardPipelineCatalogEntry {
  /** Pipeline identifier (e.g. "live-video-to-video") */
  id: string;
  /** Human-readable pipeline name */
  name: string;
  /** Models supported under this pipeline */
  models: string[];
  /** Regions where this pipeline is available */
  regions: string[];
}

/** GPU model capacity entry */
export interface DashboardGPUModelCapacity {
  model: string;
  count: number;
}

/** Model-level GPU breakdown inside a pipeline entry */
export interface DashboardGPUCapacityPipelineModel {
  model: string;
  gpus: number;
}

/** Pipeline-level GPU breakdown */
export interface DashboardGPUCapacityPipeline {
  name: string;
  gpus: number;
  models?: DashboardGPUCapacityPipelineModel[];
}

/** GPU capacity widget data */
export interface DashboardGPUCapacity {
  totalGPUs: number;
  /** GPUs that had at least one known session in the period */
  activeGPUs: number;
  availableCapacity: number;
  models: DashboardGPUModelCapacity[];
  pipelineGPUs: DashboardGPUCapacityPipeline[];
}

/** Pipeline pricing entry */
export interface DashboardPipelinePricing {
  pipeline: string;
  /** Model name within the pipeline (e.g. "stabilityai/stable-diffusion-xl-base-1.0") */
  model?: string;
  unit: string;
  price: number;
  /** Weighted avg pixelsPerUnit from capabilities_prices (pixel block size for price). */
  pixelsPerUnit?: number | null;
  outputPerDollar: string;
  /** Total capacity (warm + cold orchestrators) for this pipeline+model from /net/models. */
  capacity?: number;
}

/** Per-pipeline model(s) offered by an orchestrator (from SLA rows). */
export interface DashboardPipelineModelOffer {
  pipelineId: string;
  modelIds: string[];
}

/** Single orchestrator row aggregated over a time window */
export interface DashboardOrchestrator {
  address: string;
  uri?: string;
  knownSessions: number;
  successSessions: number;
  successRatio: number;
  effectiveSuccessRate: number | null;
  noSwapRatio: number | null;
  slaScore: number | null;
  pipelines: string[];
  pipelineModels: DashboardPipelineModelOffer[];
  gpuCount: number;
}

/** Full dashboard query response shape (all fields optional for partial providers) */
export interface DashboardData {
  // Optimized/summary data
  kpi?: DashboardKPI | null;
  protocol?: DashboardProtocol | null;
  fees?: DashboardFeesInfo | null;
  pipelines?: DashboardPipelineUsage[] | null;
  pipelineCatalog?: DashboardPipelineCatalogEntry[] | null;
  gpuCapacity?: DashboardGPUCapacity | null;
  pricing?: DashboardPipelinePricing[] | null;
  orchestrators?: DashboardOrchestrator[] | null;
}

// ============================================================================
// Event Bus Payload Types
// ============================================================================

/** Request payload sent by the dashboard to the provider */
export interface DashboardQueryRequest {
  query: string;
  variables?: Record<string, unknown>;
}

/** Response payload returned by the provider to the dashboard */
export interface DashboardQueryResponse {
  data: DashboardData | null;
  errors?: { message: string; path?: string[] }[];
}

/** Response from the job feed subscription event */
export interface JobFeedSubscribeResponse {
  /** Ably channel name to subscribe to (null if using event bus fallback) */
  channelName: string | null;
  /** Ably event name to listen for */
  eventName: string;
  /** Whether this provider uses event bus fallback instead of Ably */
  useEventBusFallback: boolean;
  /** BFF URL to poll for job feed data (used when useEventBusFallback is true) */
  fetchUrl?: string | null;
}

/** Shape of a single job feed entry */
export interface JobFeedEntry {
  id: string;
  pipeline: string;
  model?: string;
  status: 'running' | 'online' | 'degraded_input' | 'degraded_inference' | 'degraded_output' | 'degraded' | 'completed' | 'failed' | string;
  startedAt: string;
  latencyMs?: number;
  gateway?: string;
  orchestratorUrl?: string;
  inputFps?: number;
  outputFps?: number;
  lastSeen?: string;
  durationSeconds?: number;
  runningFor?: string;
}

// ============================================================================
// Resolver Interface (used by createDashboardProvider)
// ============================================================================

/**
 * Resolver map for dashboard data providers.
 *
 * Each key corresponds to a root Query field in DASHBOARD_SCHEMA.
 * All resolvers are optional — implement only what your plugin provides.
 * Unimplemented resolvers return null (GraphQL handles this gracefully).
 */
export interface DashboardResolvers {
  // Optimized/summary resolvers
  kpi?: (args: { window?: string; timeframe?: string }) => DashboardKPI | Promise<DashboardKPI>;
  protocol?: () => DashboardProtocol | Promise<DashboardProtocol>;
  fees?: (args: { days?: number }) => DashboardFeesInfo | Promise<DashboardFeesInfo>;
  pipelines?: (args: { limit?: number; timeframe?: string }) => DashboardPipelineUsage[] | Promise<DashboardPipelineUsage[]>;
  pipelineCatalog?: () => DashboardPipelineCatalogEntry[] | Promise<DashboardPipelineCatalogEntry[]>;
  gpuCapacity?: (args: { timeframe?: string }) => DashboardGPUCapacity | Promise<DashboardGPUCapacity>;
  pricing?: () => DashboardPipelinePricing[] | Promise<DashboardPipelinePricing[]>;
  orchestrators?: (args: { period?: string }) => DashboardOrchestrator[] | Promise<DashboardOrchestrator[]>;
}
