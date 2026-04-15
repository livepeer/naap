import type { EnrichedCapability } from '../types.js';

export interface SourceContext {
  authToken: string;
  requestUrl: string;
  cookieHeader?: string | null;
}

export interface PartialCapability {
  id: string;
  fields: Partial<EnrichedCapability>;
}

export interface SourceResult {
  capabilities: PartialCapability[];
  status: 'success' | 'error' | 'partial';
  durationMs: number;
  errorMessage?: string;
}

export interface CapabilityDataSource {
  readonly id: string;
  readonly name: string;
  readonly type: 'core' | 'enrichment';
  fetch(ctx: SourceContext): Promise<SourceResult>;
}
