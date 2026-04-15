export type { CapabilityDataSource, SourceContext, SourceResult, PartialCapability } from './interface.js';
export { registerSource, getSource, getSources, getEnabledSources, getCoreSources, getEnrichmentSources } from './registry.js';
export { ClickHouseSource } from './clickhouse-source.js';
export { HuggingFaceSource } from './huggingface-source.js';

import { registerSource } from './registry.js';
import { ClickHouseSource } from './clickhouse-source.js';
import { HuggingFaceSource } from './huggingface-source.js';

let initialized = false;

export function ensureDefaultSources(): void {
  if (initialized) return;
  initialized = true;
  registerSource(new ClickHouseSource());
  registerSource(new HuggingFaceSource());
}
