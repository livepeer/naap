/**
 * Pipeline ids and colors
 *
 * Keeps pipeline labels as canonical API ids (no display-name translations)
 * and defines stable chart colors.
 *
 * Official AI capabilities are defined in go-livepeer:
 * https://github.com/livepeer/go-livepeer/blob/master/core/capabilities.go
 *
 * A null display name means "exclude from the Top Pipelines chart".
 * Add new entries here as more pipelines come online on the network.
 */

/** Canonical live video pipeline id used across dashboard views. */
export const LIVE_VIDEO_PIPELINE_ID = 'live-video-to-video';

export const PIPELINE_DISPLAY: Record<string, string | null> = {
  // ─────────────────────────────────────────────────────────────────────────
  // Official AI Capabilities (from go-livepeer/core/capabilities.go)
  // ─────────────────────────────────────────────────────────────────────────
  'text-to-image':            'text-to-image',          // Capability_TextToImage (27)
  'image-to-image':           'image-to-image',         // Capability_ImageToImage (28)
  'image-to-video':           'image-to-video',         // Capability_ImageToVideo (29)
  'upscale':                  'upscale',                // Capability_Upscale (30)
  'audio-to-text':            'audio-to-text',          // Capability_AudioToText (31)
  'segment-anything-2':       'segment-anything-2',     // Capability_SegmentAnything2 (32)
  'llm':                      'llm',                    // Capability_LLM (33)
  'image-to-text':            'image-to-text',          // Capability_ImageToText (34)
  [LIVE_VIDEO_PIPELINE_ID]:   LIVE_VIDEO_PIPELINE_ID,   // Capability_LiveVideoToVideo (35)
  'text-to-speech':           'text-to-speech',         // Capability_TextToSpeech (36)

  // ─────────────────────────────────────────────────────────────────────────
  // Implementation-specific pipeline variants
  // ─────────────────────────────────────────────────────────────────────────
  'streamdiffusion-sdxl':     'streamdiffusion-sdxl',
  'streamdiffusion-sdxl-v2v': 'streamdiffusion-sdxl-v2v',

  // ─────────────────────────────────────────────────────────────────────────
  // OpenAI-compatible gateway pipelines (orchestrator offerings)
  // ─────────────────────────────────────────────────────────────────────────
  'openai-chat-completions':  'openai-chat-completions',
  'openai-image-generation':  'openai-image-generation',
  'openai-text-embeddings':   'openai-text-embeddings',

  // ─────────────────────────────────────────────────────────────────────────
  // Future / experimental pipelines (not yet in go-livepeer capabilities)
  // ─────────────────────────────────────────────────────────────────────────
  'text-to-video':            'text-to-video',
  'text-to-audio':            'text-to-audio',

  // ─────────────────────────────────────────────────────────────────────────
  // Excluded / internal pipelines
  // ─────────────────────────────────────────────────────────────────────────
  'noop':                     null,
};

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

  // Implementation-specific variants
  'streamdiffusion-sdxl':     '#8b5cf6',  // violet (same as image-to-image)
  'streamdiffusion-sdxl-v2v': '#10b981',  // emerald (same as live-video-to-video)
  'noop':                     '#9f1239',  // rose-800 — internal / placeholder

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
