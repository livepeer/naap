/**
 * Source Adapter Registry
 *
 * Maps SourceKind → SourceAdapter. Import getAdapter(kind) to obtain the
 * adapter for a given source, or listAdapters() for all of them.
 */

import type { SourceAdapter, SourceKind } from './types';
import { subgraphAdapter } from './subgraph';
import { clickhouseAdapter } from './clickhouse';
import { naapDiscoverAdapter } from './naap-discover';
import { naapPricingAdapter } from './naap-pricing';

export type { SourceKind, SourceAdapter, FetchCtx, NormalizedOrch, SourceStats, SourceFetchResult } from './types';
export { SOURCE_KINDS } from './types';

const REGISTRY: Record<SourceKind, SourceAdapter> = {
  'livepeer-subgraph': subgraphAdapter,
  'clickhouse-query': clickhouseAdapter,
  'naap-discover': naapDiscoverAdapter,
  'naap-pricing': naapPricingAdapter,
};

export function getAdapter(kind: SourceKind): SourceAdapter {
  const adapter = REGISTRY[kind];
  if (!adapter) throw new Error(`Unknown source kind: ${kind}`);
  return adapter;
}

export function listAdapters(): SourceAdapter[] {
  return Object.values(REGISTRY);
}
