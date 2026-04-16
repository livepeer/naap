/**
 * Maps Livepeer capability/model IDs to their canonical source URLs.
 *
 * Priority: explicit URL override > HuggingFace org/model path > empty.
 * Entries can be full URLs (https://...) or HuggingFace model paths
 * (org/model) which get prefixed with https://huggingface.co/.
 */
const MODEL_SOURCE_MAP: Record<string, string> = {
  // StreamDiffusion family (live-video-to-video)
  'streamdiffusion': 'https://github.com/cumulo-autumn/StreamDiffusion',
  'streamdiffusion-sdxl': 'https://github.com/cumulo-autumn/StreamDiffusion',
  'streamdiffusion-sdturbo': 'https://github.com/cumulo-autumn/StreamDiffusion',
  'streamdiffusion-sdxl-v2v': 'https://github.com/cumulo-autumn/StreamDiffusion',

  // Stable Diffusion
  'sd-turbo': 'stabilityai/sd-turbo',
  'sdxl-turbo': 'stabilityai/sdxl-turbo',
  'sdxl-lightning': 'ByteDance/SDXL-Lightning',
  'stable-diffusion-v1-5': 'stable-diffusion-v1-5/stable-diffusion-v1-5',
  'stable-diffusion-xl-base-1.0': 'stabilityai/stable-diffusion-xl-base-1.0',

  // Video generation
  'svd-xt': 'stabilityai/stable-video-diffusion-img2vid-xt',
  'svd': 'stabilityai/stable-video-diffusion-img2vid',
  'stable-video-diffusion-img2vid-xt-1-1': 'stabilityai/stable-video-diffusion-img2vid-xt-1-1',

  // Audio / Speech
  'whisper-large-v3': 'openai/whisper-large-v3',
  'whisper-medium': 'openai/whisper-medium',

  // LLM
  'meta-llama/Meta-Llama-3.1-8B-Instruct': 'meta-llama/Meta-Llama-3.1-8B-Instruct',
  'meta-llama/Llama-3.2-3B-Instruct': 'meta-llama/Llama-3.2-3B-Instruct',

  // Passthrough / test
  'noop': '',
};

/**
 * Resolves a Livepeer model ID to its HuggingFace org/model path.
 * Returns empty string for non-HuggingFace models (e.g. GitHub-hosted).
 */
export function resolveHuggingFaceModelId(modelId: string): string {
  const mapped = MODEL_SOURCE_MAP[modelId];
  if (mapped !== undefined) {
    if (!mapped || mapped.startsWith('https://')) return '';
    return mapped;
  }
  if (modelId.includes('/')) return modelId;
  return '';
}

export function getHuggingFaceUrl(modelId: string): string {
  const mapped = MODEL_SOURCE_MAP[modelId];

  if (mapped !== undefined) {
    if (!mapped) return '';
    if (mapped.startsWith('https://')) return mapped;
    return `https://huggingface.co/${mapped}`;
  }

  if (modelId.includes('/')) {
    return `https://huggingface.co/${modelId}`;
  }

  return '';
}
