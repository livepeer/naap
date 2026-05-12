import type { CapabilityDataSource, SourceContext, SourceResult, PartialCapability } from './interface.js';
import type { CapabilityCategory, EnrichedModel } from '../types.js';
import { PIPELINE_TO_CATEGORY } from '../types.js';
import { fetchActiveOrchestrators } from './subgraph.js';
import { generateSnippets } from '../snippets.js';
import { getHuggingFaceUrl } from '../hf-model-map.js';
import { Agent } from 'undici';

const MAX_CONCURRENT = parseInt(process.env.ONCHAIN_MAX_CONCURRENT || '10', 10);
const ORCH_TIMEOUT_MS = parseInt(process.env.ONCHAIN_ORCH_TIMEOUT_MS || '5000', 10);

const tlsInsecureAgent = new Agent({
  connect: { rejectUnauthorized: false },
});

interface OrchCapabilityResponse {
  pipeline: string;
  models: Array<{
    id: string;
    warm: boolean;
  }>;
}

interface OrchCapabilitiesEnvelope {
  capabilities?: OrchCapabilityResponse[];
}

type FetchResult =
  | { status: 'capabilities'; data: OrchCapabilityResponse[] }
  | { status: 'reachable-no-caps' }
  | { status: 'unreachable' };

function categorize(pipelineType: string): CapabilityCategory {
  return PIPELINE_TO_CATEGORY[pipelineType] || 'other';
}

function humanName(capabilityName: string): string {
  return capabilityName
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

async function fetchOrchCapabilities(serviceURI: string): Promise<FetchResult> {
  try {
    const url = serviceURI.replace(/\/+$/, '') + '/getCapabilities';
    const res = await fetch(url, {
      signal: AbortSignal.timeout(ORCH_TIMEOUT_MS),
      headers: { Accept: 'application/json' },
      // @ts-expect-error -- undici dispatcher for Node.js fetch (self-signed certs)
      dispatcher: tlsInsecureAgent,
    });
    if (!res.ok) return { status: 'reachable-no-caps' };
    const json = await res.json();
    if (Array.isArray(json) && json.length > 0) {
      return { status: 'capabilities', data: json as OrchCapabilityResponse[] };
    }
    if (json && typeof json === 'object') {
      const envelope = json as OrchCapabilitiesEnvelope;
      if (Array.isArray(envelope.capabilities) && envelope.capabilities.length > 0) {
        return { status: 'capabilities', data: envelope.capabilities };
      }
    }
    return { status: 'reachable-no-caps' };
  } catch {
    return { status: 'unreachable' };
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
      let withCaps = 0;
      let unreachable = 0;

      const tasks = withServiceURI.map((orch) => async () => {
        const result = await fetchOrchCapabilities(orch.serviceURI!);

        if (result.status === 'unreachable') {
          unreachable++;
          return;
        }

        reachable++;
        if (result.status !== 'capabilities') return;
        withCaps++;

        for (const pipeline of result.data) {
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
      const status = reachable === 0 ? 'error' : 'success';
      const parts: string[] = [];
      if (withCaps > 0) parts.push(`${withCaps} with AI capabilities`);
      if (unreachable > 0) parts.push(`${unreachable}/${total} unreachable`);

      return {
        capabilities,
        status,
        durationMs: Date.now() - start,
        errorMessage: parts.length > 0 ? parts.join(', ') : undefined,
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
