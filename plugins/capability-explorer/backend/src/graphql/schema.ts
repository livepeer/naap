export const SCHEMA_SDL = `
type Query {
  capabilities(
    category: String
    search: String
    minGpuCount: Int
    maxPriceUsd: Float
    minCapacity: Int
    sortBy: String
    sortOrder: String
    limit: Int
    offset: Int
  ): CapabilityConnection!

  capability(id: String!): EnrichedCapability

  categories: [CategoryInfo!]!

  stats: ExplorerStats!
}

type CapabilityConnection {
  items: [EnrichedCapability!]!
  total: Int!
  hasMore: Boolean!
}

type EnrichedCapability {
  id: String!
  name: String!
  category: String!
  source: String!
  version: String
  description: String
  modelSourceUrl: String
  thumbnail: String
  license: String
  tags: [String!]!
  gpuCount: Int!
  totalCapacity: Int!
  orchestratorCount: Int!
  avgLatencyMs: Float
  bestLatencyMs: Float
  avgFps: Float
  meanPriceUsd: Float
  minPriceUsd: Float
  maxPriceUsd: Float
  priceUnit: String
  sdkSnippet: SdkSnippet!
  models: [EnrichedModel!]!
  lastUpdated: String!
}

type EnrichedModel {
  modelId: String!
  name: String!
  warm: Boolean!
  huggingFaceUrl: String
  description: String
  avgFps: Float
  gpuCount: Int!
  meanPriceUsd: Float
}

type SdkSnippet {
  curl: String!
  python: String!
  javascript: String!
}

type CategoryInfo {
  id: String!
  label: String!
  count: Int!
  icon: String!
}

type ExplorerStats {
  totalCapabilities: Int!
  totalModels: Int!
  totalGpus: Int!
  totalOrchestrators: Int!
  avgPriceUsd: Float
}
`;
