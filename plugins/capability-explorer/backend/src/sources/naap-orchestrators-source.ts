import type { CapabilityDataSource, PartialCapability, SourceContext, SourceResult } from './interface.js';
import type { CapabilityCategory, EnrichedModel } from '../types.js';
import { PIPELINE_TO_CATEGORY } from '../types.js';
import { generateSnippets } from '../snippets.js';
import { getHuggingFaceUrl } from '../hf-model-map.js';

const DISCOVERY_URL = process.env.NAAP_DISCOVER_ORCHESTRATORS_URL || 'https://naap-api.cloudspe.com/v1/discover/orchestrators';
const REQUEST_TIMEOUT_MS = parseInt(process.env.NAAP_DISCOVER_ORCHESTRATORS_TIMEOUT_MS || '10000', 10);

interface DiscoveryOrchestrator {
  address?: string;
  score?: number;
  capabilities?: string[];
  recent_work?: boolean;
  last_seen?: string;
}

interface AggregatedCapability {
  id: string;
  pipelineType: string;
  modelId: string;
  orchestratorUris: Set<string>;
  warm: boolean;
  topScore: number | null;
}

function categorize(pipelineType: string): CapabilityCategory {
  return PIPELINE_TO_CATEGORY[pipelineType] || 'other';
}

function humanName(input: string): string {
  return input
    .replace(/[/:_-]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

function parseCapability(value: string): { id: string; pipelineType: string; modelId: string } | null {
  const raw = value.trim();
  if (!raw) return null;
  const slashIdx = raw.indexOf('/');
  if (slashIdx === -1) {
    return { id: raw, pipelineType: 'other', modelId: raw };
  }

  const pipelineType = raw.slice(0, slashIdx).trim();
  const modelId = raw.slice(slashIdx + 1).trim();
  if (!modelId) return null;

  return { id: modelId, pipelineType: pipelineType || 'other', modelId };
}

async function fetchOrchestrators(): Promise<DiscoveryOrchestrator[]> {
  const res = await fetch(DISCOVERY_URL, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Orchestrator discovery failed (${res.status}): ${text.slice(0, 200)}`);
  }

  const payload = await res.json();
  if (!Array.isArray(payload)) {
    throw new Error('Unexpected orchestrator discovery response: expected JSON array');
  }
  return payload as DiscoveryOrchestrator[];
}

export class NaapOrchestratorsSource implements CapabilityDataSource {
  readonly id = 'naap-orchestrators';
  readonly name = 'NaaP Orchestrator Discovery';
  readonly type = 'core' as const;

  async fetch(_ctx: SourceContext): Promise<SourceResult> {
    const start = Date.now();
    try {
      const orchestrators = await fetchOrchestrators();
      const aggregate = new Map<string, AggregatedCapability>();

      for (const orchestrator of orchestrators) {
        const address = typeof orchestrator.address === 'string' ? orchestrator.address.trim() : '';
        const capabilities = Array.isArray(orchestrator.capabilities) ? orchestrator.capabilities : [];
        if (!address || capabilities.length === 0) continue;

        for (const cap of capabilities) {
          if (typeof cap !== 'string') continue;
          const parsed = parseCapability(cap);
          if (!parsed) continue;

          const key = `${parsed.pipelineType}::${parsed.id}`;
          const existing = aggregate.get(key);
          if (existing) {
            existing.orchestratorUris.add(address);
            existing.warm = existing.warm || Boolean(orchestrator.recent_work);
            const score = typeof orchestrator.score === 'number' ? orchestrator.score : null;
            existing.topScore = score === null
              ? existing.topScore
              : Math.max(existing.topScore ?? score, score);
            continue;
          }

          aggregate.set(key, {
            id: parsed.id,
            pipelineType: parsed.pipelineType,
            modelId: parsed.modelId,
            orchestratorUris: new Set([address]),
            warm: Boolean(orchestrator.recent_work),
            topScore: typeof orchestrator.score === 'number' ? orchestrator.score : null,
          });
        }
      }

      const capabilities: PartialCapability[] = Array.from(aggregate.values()).map((item) => {
        const category = categorize(item.pipelineType);
        const orchestratorCount = item.orchestratorUris.size;
        const model: EnrichedModel = {
          modelId: item.modelId,
          name: humanName(item.modelId),
          warm: item.warm,
          huggingFaceUrl: getHuggingFaceUrl(item.modelId),
          description: null,
          avgFps: null,
          gpuCount: orchestratorCount,
          meanPriceUsd: null,
        };

        return {
          id: item.id,
          fields: {
            id: item.id,
            name: humanName(item.id),
            category,
            source: 'livepeer-network',
            version: '1.0',
            description: item.topScore === null ? '' : `Observed in NaaP discovery rankings (top score: ${item.topScore.toFixed(3)})`,
            modelSourceUrl: getHuggingFaceUrl(item.modelId),
            thumbnail: null,
            license: null,
            tags: [category, item.pipelineType, item.modelId, 'naap-discovery'],
            gpuCount: orchestratorCount,
            totalCapacity: 0,
            orchestratorCount,
            _orchestratorUris: Array.from(item.orchestratorUris),
            avgLatencyMs: null,
            avgFps: null,
            meanPriceUsd: null,
            minPriceUsd: null,
            maxPriceUsd: null,
            priceUnit: 'USD/min',
            sdkSnippet: generateSnippets(item.id, category, item.modelId),
            models: [model],
            lastUpdated: new Date().toISOString(),
          },
        };
      });

      return {
        capabilities,
        status: 'success',
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        capabilities: [],
        status: 'error',
        durationMs: Date.now() - start,
        errorMessage: err instanceof Error ? err.message : 'NaaP orchestrator discovery fetch failed',
      };
    }
  }
}
