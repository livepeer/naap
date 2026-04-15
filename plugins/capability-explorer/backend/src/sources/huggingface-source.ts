import type { CapabilityDataSource, SourceContext, SourceResult, PartialCapability } from './interface.js';
import type { EnrichedCapability } from '../types.js';
import { fetchModelCard } from '../enrichment.js';
import { resolveHuggingFaceModelId, getHuggingFaceUrl } from '../hf-model-map.js';

/**
 * HuggingFace enrichment source — fetches model cards and enriches
 * capabilities with descriptions, thumbnails, licenses, and tags.
 *
 * This source is of type 'enrichment': it takes existing capabilities
 * (from core sources) and adds HuggingFace metadata to them.
 */
export class HuggingFaceSource implements CapabilityDataSource {
  readonly id = 'huggingface';
  readonly name = 'HuggingFace Model Cards';
  readonly type = 'enrichment' as const;

  private existingCapabilities: Partial<EnrichedCapability>[] = [];

  /**
   * Set the capabilities to enrich before calling fetch().
   * The refresh engine calls this with the merged core capabilities.
   */
  setCapabilitiesToEnrich(caps: Partial<EnrichedCapability>[]): void {
    this.existingCapabilities = caps;
  }

  async fetch(ctx: SourceContext): Promise<SourceResult> {
    const start = Date.now();
    const results: PartialCapability[] = [];

    try {
      const enrichmentPromises = this.existingCapabilities.map(async (cap) => {
        const models = cap.models || [];
        const primaryModel = models[0];
        if (!primaryModel || !cap.id) return null;

        const card = await fetchModelCard(primaryModel.modelId, ctx);
        if (!card) return null;

        const enriched: PartialCapability = {
          id: cap.id,
          fields: {
            description: cap.description || card.description || '',
            thumbnail: cap.thumbnail || card.cardData?.thumbnail || null,
            license: cap.license || card.cardData?.license || null,
            tags: [...new Set([...(cap.tags || []), ...(card.tags || [])])],
            modelSourceUrl: cap.modelSourceUrl || getHuggingFaceUrl(primaryModel.modelId),
            models: models.map((m) => ({
              ...m,
              huggingFaceUrl: m.huggingFaceUrl || getHuggingFaceUrl(m.modelId),
            })),
          },
        };

        return enriched;
      });

      const settled = await Promise.allSettled(enrichmentPromises);
      for (const r of settled) {
        if (r.status === 'fulfilled' && r.value) {
          results.push(r.value);
        }
      }

      return {
        capabilities: results,
        status: 'success',
        durationMs: Date.now() - start,
      };
    } catch (err) {
      return {
        capabilities: results,
        status: results.length > 0 ? 'partial' : 'error',
        durationMs: Date.now() - start,
        errorMessage: err instanceof Error ? err.message : 'HuggingFace enrichment failed',
      };
    }
  }
}
