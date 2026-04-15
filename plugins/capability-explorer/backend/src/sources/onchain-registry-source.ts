import type { CapabilityDataSource, SourceContext, SourceResult, PartialCapability } from './interface.js';
import type { CapabilityCategory, EnrichedModel } from '../types.js';
import { PIPELINE_TO_CATEGORY } from '../types.js';
import { fetchActiveOrchestrators } from './subgraph.js';
import { generateSnippets } from '../snippets.js';
import { getHuggingFaceUrl } from '../hf-model-map.js';

const MAX_CONCURRENT = parseInt(process.env.ONCHAIN_MAX_CONCURRENT || '10', 10);
const ORCH_TIMEOUT_MS = parseInt(process.env.ONCHAIN_ORCH_TIMEOUT_MS || '5000', 10);

interface OrchCapabilityResponse {
  pipeline: string;
  models: Array<{
    id: string;
    warm: boolean;
  }>;
}

function categorize(pipelineType: string): CapabilityCategory {
  return PIPELINE_TO_CATEGORY[pipelineType] || 'other';
}

function humanName(capabilityName: string): string {
  return capabilityName
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

async function fetchOrchCapabilities(
  serviceURI: string,
): Promise<OrchCapabilityResponse[] | null> {
  try {
    const url = serviceURI.replace(/\/+$/, '') + '/getCapabilities';
    const res = await fetch(url, {
      signal: AbortSignal.timeout(ORCH_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (Array.isArray(json)) return json as OrchCapabilityResponse[];
    if (json && typeof json === 'object' && Array.isArray(json.capabilities)) {
      return json.capabilities as OrchCapabilityResponse[];
    }
    return null;
  } catch {
    return null;
  }
}

async function runWithConcurrency<T>(
  tasks: Array<() => Promise<T>>,
  limit: number,
): Promise<T[]> {
  const results: T[] = [];
  let idx = 0;

  async function next(): Promise<void> {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => next());
  await Promise.all(workers);
  return results;
}

interface AggregatedCapability {
  capabilityName: string;
  pipelineType: string;
  orchestratorUris: Set<string>;
  models: Map<string, { warm: boolean }>;
}

export class OnChainRegistrySource implements CapabilityDataSource {
  readonly id = 'onchain-registry';
  readonly name = 'On-Chain Orchestrator Registry';
  readonly type = 'core' as const;

  async fetch(_ctx: SourceContext): Promise<SourceResult> {
    const start = Date.now();
    try {
      const orchestrators = await fetchActiveOrchestrators();
      const withServiceURI = orchestrators.filter(
        (o) => o.serviceURI && o.serviceURI.startsWith('http'),
      );

      if (withServiceURI.length === 0) {
        return {
          capabilities: [],
          status: 'success',
          durationMs: Date.now() - start,
        };
      }

      const aggregated = new Map<string, AggregatedCapability>();
      let reachable = 0;

      const tasks = withServiceURI.map((orch) => async () => {
        const caps = await fetchOrchCapabilities(orch.serviceURI!);
        if (!caps) return;
        reachable++;

        for (const pipeline of caps) {
          const pipelineType = pipeline.pipeline || '';
          for (const model of pipeline.models || []) {
            const capName = model.id || pipelineType;
            let entry = aggregated.get(capName);
            if (!entry) {
              entry = {
                capabilityName: capName,
                pipelineType,
                orchestratorUris: new Set(),
                models: new Map(),
              };
              aggregated.set(capName, entry);
            }
            entry.orchestratorUris.add(orch.serviceURI!);
            if (!entry.models.has(model.id)) {
              entry.models.set(model.id, { warm: model.warm ?? true });
            }
          }
        }
      });

      await runWithConcurrency(tasks, MAX_CONCURRENT);

      const capabilities: PartialCapability[] = Array.from(aggregated.values()).map(
        (agg) => {
          const category = categorize(agg.pipelineType);
          const orchUris = Array.from(agg.orchestratorUris);
          const primaryModelId = agg.capabilityName;

          const models: EnrichedModel[] = Array.from(agg.models.entries()).map(
            ([modelId, info]) => ({
              modelId,
              name: humanName(modelId),
              warm: info.warm,
              huggingFaceUrl: getHuggingFaceUrl(modelId),
              description: null,
              avgFps: null,
              gpuCount: 0,
              meanPriceUsd: null,
            }),
          );

          return {
            id: agg.capabilityName,
            fields: {
              id: agg.capabilityName,
              name: humanName(agg.capabilityName),
              category,
              source: 'livepeer-network',
              version: '1.0',
              description: '',
              modelSourceUrl: getHuggingFaceUrl(primaryModelId),
              thumbnail: null,
              license: null,
              tags: [category, agg.pipelineType, agg.capabilityName],
              gpuCount: orchUris.length,
              totalCapacity: 0,
              orchestratorCount: orchUris.length,
              _orchestratorUris: orchUris,
              avgLatencyMs: null,
              bestLatencyMs: null,
              avgFps: null,
              meanPriceUsd: null,
              minPriceUsd: null,
              maxPriceUsd: null,
              priceUnit: 'USD/min',
              sdkSnippet: generateSnippets(agg.capabilityName, category, primaryModelId),
              models,
              lastUpdated: new Date().toISOString(),
            },
          };
        },
      );

      const total = withServiceURI.length;
      const status = reachable === 0 ? 'error' : reachable < total ? 'partial' : 'success';

      return {
        capabilities,
        status,
        durationMs: Date.now() - start,
        errorMessage:
          reachable < total
            ? `${total - reachable}/${total} orchestrators unreachable`
            : undefined,
      };
    } catch (err) {
      return {
        capabilities: [],
        status: 'error',
        durationMs: Date.now() - start,
        errorMessage: err instanceof Error ? err.message : 'On-chain registry fetch failed',
      };
    }
  }
}
