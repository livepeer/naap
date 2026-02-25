/**
 * Model catalog display names and exclusion list.
 *
 * Maps internal leaderboard API identifiers to user-friendly labels.
 * A null MODEL_DISPLAY entry means "exclude from the model catalog".
 */

/** Parent pipeline ID -> display category name */
export const PIPELINE_DISPLAY: Record<string, string> = {
  'live-video-to-video': 'Video-to-Video',
  'llm':                 'LLM',
  'text-to-image':       'Text-to-Image',
  'upscale':             'Upscale',
};

/**
 * Model ID -> human-readable name.
 * A null value means "exclude from listing" (benchmark / health-check).
 */
export const MODEL_DISPLAY: Record<string, string | null> = {
  'streamdiffusion-sdxl':                     'SDXL StreamDiffusion',
  'streamdiffusion-sdxl-v2v':                 'SDXL StreamDiffusion V2V',
  'black-forest-labs/FLUX.1-dev':             'FLUX.1 Dev',
  'SG161222/RealVisXL_V4.0_Lightning':        'RealVisXL V4 Lightning',
  'meta-llama/Meta-Llama-3.1-8B-Instruct':    'Llama 3.1 8B Instruct',
  'glm-4.7-flash':                            'GLM-4 Flash',
  'llama3.2-vision':                          'Llama 3.2 Vision',
  'stabilityai/stable-diffusion-x4-upscaler': 'SD x4 Upscaler',
  'noop':                                     null, // benchmark - not a real workload
};

/**
 * Models to exclude from the catalog entirely.
 * Used when MODEL_DISPLAY has a null entry or the model is unlisted.
 */
export const EXCLUDED_MODELS = new Set(['noop']);

/**
 * FPS threshold above which a model is considered real-time
 * (suitable for interactive / live applications).
 */
export const REALTIME_FPS_THRESHOLD = 15;

/** Fallback display name for unknown GPU hardware */
export const UNKNOWN_GPU = 'Unknown GPU';
