export const SCHEMA_SDL = `
"""
Livepeer Network Capability Explorer API.
Browse AI capabilities, models, GPU availability, pricing, and latency
aggregated from the live Livepeer orchestrator network.
"""
type Query {
  """
  List capabilities with optional filters, sorting, and pagination.
  Category values: llm, t2i, t2v, i2i, i2v, a2t, tts, upscale, live-video, other.
  SortBy values: name, gpuCount, price, latency, capacity.
  """
  capabilities(
    "Filter by capability category (e.g. live-video, llm, t2i)"
    category: String
    "Full-text search across capability name and tags"
    search: String
    "Minimum number of GPUs serving this capability"
    minGpuCount: Int
    "Maximum mean price in USD/min"
    maxPriceUsd: Float
    "Minimum available capacity (free slots)"
    minCapacity: Int
    "Sort field: name, gpuCount, price, latency, capacity"
    sortBy: String
    "Sort direction: asc or desc"
    sortOrder: String
    "Max results to return (default 50, max 100)"
    limit: Int
    "Offset for pagination (default 0)"
    offset: Int
  ): CapabilityConnection!

  "Fetch a single capability by its ID (the model/capability name)"
  capability(id: String!): EnrichedCapability

  "List all capability categories with counts"
  categories: [CategoryInfo!]!

  "Aggregate network statistics across all capabilities"
  stats: ExplorerStats!
}

"Paginated list of capabilities"
type CapabilityConnection {
  items: [EnrichedCapability!]!
  total: Int!
  hasMore: Boolean!
}

"An AI capability available on the Livepeer network"
type EnrichedCapability {
  "Unique identifier (matches the capability/model name)"
  id: String!
  "Human-readable display name"
  name: String!
  "Category: llm, t2i, t2v, i2i, i2v, a2t, tts, upscale, live-video, other"
  category: String!
  "Data source identifier (e.g. livepeer-network)"
  source: String!
  version: String
  description: String
  "URL to the model source repository (GitHub or HuggingFace)"
  modelSourceUrl: String
  thumbnail: String
  license: String
  "Searchable tags including category, pipeline type, and model name"
  tags: [String!]!
  "Total GPU instances serving this capability across all orchestrators"
  gpuCount: Int!
  "Available capacity (free processing slots)"
  totalCapacity: Int!
  "Number of distinct orchestrators offering this capability"
  orchestratorCount: Int!
  "Average latency in milliseconds (from gateway measurements)"
  avgLatencyMs: Float
  avgFps: Float
  "Mean price in USD per minute of 1024x1024 video at 30fps"
  meanPriceUsd: Float
  "Minimum price across all orchestrators (USD/min)"
  minPriceUsd: Float
  "Maximum price across all orchestrators (USD/min)"
  maxPriceUsd: Float
  "Price unit label (e.g. USD/min)"
  priceUnit: String
  "Ready-to-use code snippets for calling this capability"
  sdkSnippet: SdkSnippet!
  "Individual model instances serving this capability"
  models: [EnrichedModel!]!
  "ISO 8601 timestamp of last data refresh"
  lastUpdated: String!
}

"A model instance available on the network"
type EnrichedModel {
  "Model identifier (e.g. streamdiffusion-sdxl)"
  modelId: String!
  "Human-readable model name"
  name: String!
  "Whether the model is currently warm (ready to serve)"
  warm: Boolean!
  "URL to the model source (GitHub or HuggingFace)"
  huggingFaceUrl: String
  description: String
  avgFps: Float
  "Number of GPU instances running this model"
  gpuCount: Int!
  "Mean price in USD/min for this model"
  meanPriceUsd: Float
}

"Code snippets for integrating with a capability via the Livepeer gateway"
type SdkSnippet {
  curl: String!
  python: String!
  javascript: String!
}

"A capability category with its display metadata"
type CategoryInfo {
  "Category identifier (e.g. live-video, llm, t2i)"
  id: String!
  "Human-readable label"
  label: String!
  "Number of capabilities in this category"
  count: Int!
  "Lucide icon name for UI rendering"
  icon: String!
}

"Aggregate statistics across the entire Livepeer AI network"
type ExplorerStats {
  totalCapabilities: Int!
  totalModels: Int!
  "Total GPU instances across all capabilities"
  totalGpus: Int!
  "Total distinct orchestrators"
  totalOrchestrators: Int!
  "Network-wide average price in USD/min"
  avgPriceUsd: Float
}
`;
