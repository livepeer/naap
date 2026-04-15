export type { CapabilityDataSource, SourceContext, SourceResult, PartialCapability } from './interface.js';
export { registerSource, getSource, getSources, getEnabledSources, getCoreSources, getEnrichmentSources } from './registry.js';
export { ClickHouseSource } from './clickhouse-source.js';
export { OnChainRegistrySource } from './onchain-registry-source.js';
export { HuggingFaceSource } from './huggingface-source.js';

import { registerSource } from './registry.js';
import { ClickHouseSource } from './clickhouse-source.js';
import { OnChainRegistrySource } from './onchain-registry-source.js';
import { HuggingFaceSource } from './huggingface-source.js';

let initialized = false;

export function ensureDefaultSources(): void {
  if (initialized) return;
  registerSource(new ClickHouseSource());
  registerSource(new OnChainRegistrySource());
  registerSource(new HuggingFaceSource());
  initialized = true;
}
