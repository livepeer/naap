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
    kpi(window: String, timeframe: String): KPI
    protocol: Protocol
    fees(days: Int): FeesInfo
    pipelines(limit: Int, timeframe: String): [PipelineUsage!]
    pipelineCatalog: [PipelineCatalogEntry!]
    gpuCapacity: GPUCapacity
    pricing: [PipelinePricing!]
    orchestrators(period: String): [OrchestratorRow!]
  }

  type KPI {
    successRate: MetricDelta!
    orchestratorsOnline: MetricDelta!
    dailyUsageMins: MetricDelta!
    dailyStreamCount: MetricDelta!
    dailyNetworkFeesEth: MetricDelta!
    timeframeHours: Int!
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
    volumeChangeUsd: Float!
    volumeChangeEth: Float!
    weeklyVolumeChangeUsd: Float!
    weeklyVolumeChangeEth: Float!
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
    mins: Int!
  }

  type PipelineUsage {
    name: String!
    mins: Int!
    color: String
    modelMins: [PipelineModelMins!]
  }

  type PipelineCatalogEntry {
    id: String!
    name: String!
    models: [String!]!
  }

  type GPUModelCapacity {
    model: String!
    count: Int!
  }

  type GPUCapacity {
    totalGPUs: Int!
    availableCapacity: Float!
    models: [GPUModelCapacity!]!
  }

  type PipelinePricing {
    pipeline: String!
    unit: String!
    price: Float!
    outputPerDollar: String!
  }

  type PipelineModelOffer {
    pipelineId: String!
    modelIds: [String!]!
  }

  type OrchestratorRow {
    address: String!
    knownSessions: Int!
    successSessions: Int!
    successRatio: Float!
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

/** KPI widget data */
export interface DashboardKPI {
  successRate: MetricDelta;
  orchestratorsOnline: MetricDelta;
  dailyUsageMins: MetricDelta;
  dailyStreamCount: MetricDelta;
  dailyNetworkFeesEth: MetricDelta;
  /** The timeframe in hours that this KPI data covers */
  timeframeHours: number;
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
  volumeChangeUsd: number;
  volumeChangeEth: number;
  weeklyVolumeChangeUsd: number;
  weeklyVolumeChangeEth: number;
  dayData: DashboardFeeDayData[];
  weeklyData: DashboardFeeWeeklyData[];
}

/** Pipeline usage entry */
export interface DashboardPipelineModelMins {
  model: string;
  mins: number;
}

export interface DashboardPipelineUsage {
  name: string;
  mins: number;
  color?: string;
  /** Per-model inference minutes (when available) */
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
}

/** GPU model capacity entry */
export interface DashboardGPUModelCapacity {
  model: string;
  count: number;
}

/** GPU capacity widget data */
export interface DashboardGPUCapacity {
  totalGPUs: number;
  availableCapacity: number;
  models: DashboardGPUModelCapacity[];
}

/** Pipeline pricing entry */
export interface DashboardPipelinePricing {
  pipeline: string;
  unit: string;
  price: number;
  outputPerDollar: string;
}

/** Per-pipeline model(s) offered by an orchestrator (from SLA rows). */
export interface DashboardPipelineModelOffer {
  pipelineId: string;
  modelIds: string[];
}

/** Single orchestrator row aggregated over a time window */
export interface DashboardOrchestrator {
  address: string;
  knownSessions: number;
  successSessions: number;
  successRatio: number;
  noSwapRatio: number | null;
  slaScore: number | null;
  pipelines: string[];
  pipelineModels: DashboardPipelineModelOffer[];
  gpuCount: number;
}

/** Full dashboard query response shape (all fields optional for partial providers) */
export interface DashboardData {
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
}

/** Shape of a single job feed entry */
export interface JobFeedEntry {
  id: string;
  pipeline: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  latencyMs?: number;
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
  kpi?: (args: { window?: string; timeframe?: string }) => DashboardKPI | Promise<DashboardKPI>;
  protocol?: () => DashboardProtocol | Promise<DashboardProtocol>;
  fees?: (args: { days?: number }) => DashboardFeesInfo | Promise<DashboardFeesInfo>;
  pipelines?: (args: { limit?: number; timeframe?: string }) => DashboardPipelineUsage[] | Promise<DashboardPipelineUsage[]>;
  pipelineCatalog?: () => DashboardPipelineCatalogEntry[] | Promise<DashboardPipelineCatalogEntry[]>;
  gpuCapacity?: () => DashboardGPUCapacity | Promise<DashboardGPUCapacity>;
  pricing?: () => DashboardPipelinePricing[] | Promise<DashboardPipelinePricing[]>;
  orchestrators?: (args: { period?: string }) => DashboardOrchestrator[] | Promise<DashboardOrchestrator[]>;
}
