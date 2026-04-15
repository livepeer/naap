export * from './types.js';
export { handleListCapabilities } from './handlers/list-capabilities.js';
export { handleGetCapability } from './handlers/get-capability.js';
export { handleGetCapabilityModels } from './handlers/get-capability-models.js';
export { handleListCategories } from './handlers/list-categories.js';
export { handleGetFilters } from './handlers/get-filters.js';
export { handleGetStats } from './handlers/get-stats.js';
export { handleGraphQL } from './handlers/graphql.js';

// V2: Query CRUD handlers
export { handleListQueries } from './handlers/queries-list.js';
export { handleCreateQuery, handleGetQuery, handleUpdateQuery, handleDeleteQuery } from './handlers/queries-crud.js';
export { handleGetQueryResults } from './handlers/queries-results.js';
export { handleSeedQueries } from './handlers/queries-seed.js';

// V2: Admin handlers
export { handleGetConfig, handleUpdateConfig } from './handlers/admin-config.js';
export { handleAdminRefresh } from './handlers/admin-refresh.js';
export { handleGetSources, handleGetSnapshots } from './handlers/admin-sources.js';

// V2: Refresh engine
export { refreshCapabilities, isRefreshDue } from './refresh.js';
export type { RefreshResult } from './refresh.js';

// V2: Sources
export type { CapabilityDataSource, SourceContext, SourceResult, PartialCapability } from './sources/interface.js';
export { registerSource, getSources, getEnabledSources } from './sources/registry.js';
export { ensureDefaultSources } from './sources/index.js';

// V2: Queries
export type { QueryScope } from './queries.js';
export { seedDemoQueries } from './queries.js';
