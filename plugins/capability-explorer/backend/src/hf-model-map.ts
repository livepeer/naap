/**
 * Maps Livepeer model IDs to HuggingFace model paths.
 * Many Livepeer model IDs are already valid HuggingFace paths.
 * This map provides overrides for cases where they differ.
 */
export const HF_MODEL_MAP: Record<string, string> = {
  'sd-turbo': 'stabilityai/sd-turbo',
  'sdxl-turbo': 'stabilityai/sdxl-turbo',
  'sdxl-lightning': 'ByteDance/SDXL-Lightning',
  'svd-xt': 'stabilityai/stable-video-diffusion-img2vid-xt',
  'svd': 'stabilityai/stable-video-diffusion-img2vid',
  'whisper-large-v3': 'openai/whisper-large-v3',
  'whisper-medium': 'openai/whisper-medium',
  'noop': '',
};

export function resolveHuggingFaceModelId(livepeerModelId: string): string {
  if (HF_MODEL_MAP[livepeerModelId] !== undefined) {
    return HF_MODEL_MAP[livepeerModelId];
  }
  // If the model ID already looks like an org/model path, use as-is
  if (livepeerModelId.includes('/')) {
    return livepeerModelId;
  }
  return livepeerModelId;
}

export function getHuggingFaceUrl(modelId: string): string {
  const hfId = resolveHuggingFaceModelId(modelId);
  if (!hfId) return '';
  return `https://huggingface.co/${hfId}`;
}
