/**
 * Pipeline ids and colors
 *
 * Official AI capabilities are defined in go-livepeer:
 * https://github.com/livepeer/go-livepeer/blob/master/core/capabilities.go
 */

/** Canonical live video pipeline id used across dashboard views. */
export const LIVE_VIDEO_PIPELINE_ID = 'live-video-to-video';

/**
 * Color map keyed by pipeline ID. Model badges and labels inherit this color
 * from their parent pipeline.
 */
export const PIPELINE_COLOR: Record<string, string> = {
  // Official AI Capabilities
  'text-to-image':            '#f59e0b',  // amber
  'image-to-image':           '#8b5cf6',  // violet
  'image-to-video':           '#3b82f6',  // blue
  'upscale':                  '#84cc16',  // lime
  'audio-to-text':            '#06b6d4',  // cyan
  'segment-anything-2':       '#f97316',  // orange
  'llm':                      '#a855f7',  // purple
  'image-to-text':            '#ec4899',  // pink
  [LIVE_VIDEO_PIPELINE_ID]:   '#10b981',  // emerald
  'text-to-speech':           '#14b8a6',  // teal

  // OpenAI-compatible gateways
  'openai-chat-completions':  '#8b5cf6',  // violet
  'openai-image-generation':  '#f59e0b',  // amber
  'openai-text-embeddings':   '#3b82f6',  // blue

  // Future / experimental
  'text-to-video':            '#ec4899',  // pink
  'text-to-audio':            '#14b8a6',  // teal
};

/** Fallback color for pipelines not listed above */
export const DEFAULT_PIPELINE_COLOR = '#6366f1';
