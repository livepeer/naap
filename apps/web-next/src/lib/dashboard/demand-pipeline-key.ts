/**
 * Maps NAAP `network/demand` rows to dashboard pipeline id + model id.
 * Shared by {@link resolvePipelines} and pipeline catalog demand augment so
 * rows with missing `pipeline_id` (common for live-video) are not dropped
 * from the catalog while usage still attributes them correctly.
 */

import type { NetworkDemandRow } from './raw-data.js';
import { PIPELINE_DISPLAY } from './pipeline-config.js';

export const LIVE_VIDEO_PIPELINE_ID = 'live-video-to-video';

const LIVE_VIDEO_MODEL_IDS = new Set(['noop', 'streamdiffusion-sdxl', 'streamdiffusion-sdxl-v2v']);

export function normalizeModelId(m: string): string {
  return m.startsWith('streamdiffusion') && !LIVE_VIDEO_MODEL_IDS.has(m) ? 'streamdiffusion-sdxl' : m;
}

export interface DemandRowPipelineKeys {
  pipelineKey: string;
  modelKey: string | null;
}

export function pipelineKeysFromDemandRow(row: NetworkDemandRow): DemandRowPipelineKeys | null {
  const rawModel = row.model_id?.trim() || null;
  const rawPipeline = row.pipeline_id?.trim() || null;
  const normalizedModel = rawModel ? normalizeModelId(rawModel) : null;

  if (rawPipeline === LIVE_VIDEO_PIPELINE_ID || LIVE_VIDEO_MODEL_IDS.has(normalizedModel ?? '')) {
    return {
      pipelineKey: LIVE_VIDEO_PIPELINE_ID,
      modelKey: normalizedModel ?? rawModel,
    };
  }
  if (rawPipeline) {
    if (PIPELINE_DISPLAY[rawPipeline] === null) return null;
    return { pipelineKey: rawPipeline, modelKey: rawModel };
  }
  const pipelineKey = rawModel || '';
  if (!pipelineKey || PIPELINE_DISPLAY[pipelineKey] === null) return null;
  return { pipelineKey, modelKey: null };
}

export function demandRowHasActivity(row: NetworkDemandRow): boolean {
  const mins = row.total_minutes ?? 0;
  const sessionsCt = row.sessions_count ?? 0;
  return mins > 0 || sessionsCt > 0;
}

export function isLiveVideoDemandRow(row: Pick<NetworkDemandRow, 'pipeline_id' | 'model_id'>): boolean {
  const p = row.pipeline_id?.trim() ?? '';
  const raw = row.model_id?.trim() ?? '';
  const m = raw ? normalizeModelId(raw) : '';
  return p === LIVE_VIDEO_PIPELINE_ID || LIVE_VIDEO_MODEL_IDS.has(m);
}
