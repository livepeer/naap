/**
 * Daydream.live API Client
 *
 * Handles communication with the Daydream StreamDiffusion API
 * API Docs: https://docs.daydream.live/quickstart
 */

/** Sanitize a value for safe log output (prevents log injection) */
function sanitizeForLog(value: unknown): string {
  return String(value).replace(/[\n\r\t\x00-\x1f\x7f-\x9f]/g, '');
}

const DAYDREAM_API = 'https://api.daydream.live';

// Available models based on Daydream API documentation
export const MODELS = [
  {
    id: 'stabilityai/sd-turbo',
    name: 'SD Turbo',
    description: 'Fast SD model, optimized for real-time',
    controlnetPrefix: 'lllyasviel/sd-controlnet'
  },
  {
    id: 'stabilityai/sdxl-turbo',
    name: 'SDXL Turbo',
    description: 'High quality SDXL model',
    controlnetPrefix: 'diffusers/controlnet-canny-sdxl-1.0'
  },
  {
    id: 'prompthero/openjourney-v4',
    name: 'OpenJourney v4',
    description: 'Artistic SD 1.5 model',
    controlnetPrefix: 'lllyasviel/sd-controlnet'
  },
  {
    id: 'Lykon/dreamshaper-8',
    name: 'DreamShaper 8',
    description: 'Versatile SD 1.5 model',
    controlnetPrefix: 'lllyasviel/sd-controlnet'
  },
];

// ControlNet configurations for SD 1.5 / SD Turbo
export const CONTROLNETS_SD15 = [
  {
    name: 'pose',
    displayName: 'Pose',
    description: 'Body and hand pose tracking',
    model_id: 'lllyasviel/sd-controlnet-openpose',
    preprocessor: 'pose_tensorrt',
    preprocessor_params: {},
  },
  {
    name: 'edge',
    displayName: 'Edge (HED)',
    description: 'Soft edge detection',
    model_id: 'lllyasviel/sd-controlnet-hed',
    preprocessor: 'soft_edge',
    preprocessor_params: {},
  },
  {
    name: 'canny',
    displayName: 'Canny',
    description: 'Sharp edge detection',
    model_id: 'lllyasviel/sd-controlnet-canny',
    preprocessor: 'canny',
    preprocessor_params: {
      high_threshold: 200,
      low_threshold: 100,
    },
  },
  {
    name: 'depth',
    displayName: 'Depth',
    description: '3D structure preservation',
    model_id: 'lllyasviel/sd-controlnet-depth',
    preprocessor: 'depth_tensorrt',
    preprocessor_params: {},
  },
];

// ControlNet configurations for SDXL
export const CONTROLNETS_SDXL = [
  {
    name: 'canny',
    displayName: 'Canny',
    description: 'Sharp edge detection',
    model_id: 'diffusers/controlnet-canny-sdxl-1.0',
    preprocessor: 'canny',
    preprocessor_params: {
      high_threshold: 200,
      low_threshold: 100,
    },
  },
  {
    name: 'depth',
    displayName: 'Depth',
    description: '3D structure preservation',
    model_id: 'diffusers/controlnet-depth-sdxl-1.0',
    preprocessor: 'depth_tensorrt',
    preprocessor_params: {},
  },
];

// Get controlnets for a given model
export function getControlnetsForModel(modelId: string) {
  // Guard against type confusion from parameter tampering (e.g., arrays from query strings)
  if (typeof modelId !== 'string') {
    return CONTROLNETS_SD15;
  }
  if (modelId.includes('sdxl')) {
    return CONTROLNETS_SDXL;
  }
  return CONTROLNETS_SD15;
}

// Default controlnets (for backward compatibility)
export const CONTROLNETS = CONTROLNETS_SD15;

/**
 * List available models/pipelines from Daydream API
 */
export async function listModels(apiKey: string): Promise<typeof MODELS> {
  try {
    const response = await fetch(`${DAYDREAM_API}/v1/models`, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    });

    if (!response.ok) {
      console.warn(`Daydream models API returned ${response.status}. Using default list.`);
      return MODELS;
    }

    const data = await response.json() as Record<string, unknown> | Array<Record<string, unknown>>;
    const isModel = (m: unknown): m is { id: string } => !!m && typeof m === 'object' && 'id' in (m as Record<string, unknown>);

    if (Array.isArray(data) && data.length > 0 && isModel(data[0])) return data as typeof MODELS;
    if (!Array.isArray(data) && Array.isArray(data.models)) {
      const models = (data.models as unknown[]).filter(isModel);
      if (models.length > 0) return models as typeof MODELS;
    }
    if (!Array.isArray(data) && Array.isArray(data.data)) {
      const models = (data.data as unknown[]).filter(isModel);
      if (models.length > 0) return models as typeof MODELS;
    }

    return MODELS;
  } catch (error) {
    console.error('Error fetching models from Daydream:', error);
    return MODELS;
  }
}

export interface StreamParams {
  prompt: string;
  model_id?: string;
  negative_prompt?: string;
  seed?: number;
  guidance_scale?: number;
  num_inference_steps?: number;
  t_index_list?: number[];
  controlnets?: ControlNetConfig[];
  width?: number;
  height?: number;
}

export interface ControlNetConfig {
  conditioning_scale: number;
  control_guidance_end: number;
  control_guidance_start: number;
  enabled: boolean;
  model_id: string;
  preprocessor: string;
  preprocessor_params: Record<string, unknown>;
}

export interface CreateStreamResponse {
  id: string;
  output_playback_id: string;
  whip_url: string;
  stream_key?: string;
  output_stream_url?: string;
  params?: Record<string, unknown>;
  [key: string]: unknown;
}

export interface DaydreamError {
  error: string;
  message: string;
  status?: number;
}

/**
 * Create a new Daydream stream
 */
export async function createStream(
  apiKey: string,
  params?: Partial<StreamParams>
): Promise<CreateStreamResponse> {
  const defaultParams = {
    model_id: params?.model_id || 'stabilityai/sd-turbo',
    prompt: params?.prompt || 'cinematic, high quality',
    negative_prompt: params?.negative_prompt || 'blurry, low quality, flat, 2d',
    seed: params?.seed || 42,
    guidance_scale: params?.guidance_scale || 1.0,
    num_inference_steps: params?.num_inference_steps || 2,
    t_index_list: params?.t_index_list || [0, 1],
    width: params?.width || 512,
    height: params?.height || 512,
  };

  const body = {
    pipeline: 'streamdiffusion',
    params: defaultParams,
  };

  console.log('Creating stream with params:', JSON.stringify(body, null, 2));

  const response = await fetch(`${DAYDREAM_API}/v1/streams`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Create stream error:', response.status, errorText);
    throw new Error(`Failed to create stream: ${response.status} ${errorText}`);
  }

  const result = (await response.json()) as CreateStreamResponse;
  console.log('Stream created:', result.id);
  return result;
}

/**
 * Validate that a stream ID is safe to use in URL paths.
 * Daydream API treats stream IDs as opaque strings, so we only check
 * it's a non-empty string without path traversal characters.
 * Also decodes percent-encoded sequences to block encoded traversal (%2e%2e, %2f).
 */
function validateStreamId(streamId: string): void {
  if (typeof streamId !== 'string' || streamId.length === 0) {
    throw new Error('Stream ID must be a non-empty string');
  }
  // Decode percent-encoded sequences, then check for traversal in both forms
  let decoded: string;
  try {
    decoded = decodeURIComponent(streamId);
  } catch {
    decoded = streamId;
  }
  if (
    decoded.includes('..') || decoded.includes('/') || decoded.includes('\\') ||
    streamId.includes('..') || streamId.includes('/') || streamId.includes('\\')
  ) {
    throw new Error('Stream ID contains invalid path characters');
  }
}

/**
 * Update stream parameters
 * According to Daydream API docs, PATCH only needs the params object
 */
export async function updateStreamParams(
  apiKey: string,
  streamId: string,
  params: StreamParams
): Promise<unknown> {
  validateStreamId(streamId);

  // Build the params object - only include what's provided
  const updateParams: Record<string, unknown> = {};

  if (params.prompt !== undefined) {
    updateParams.prompt = params.prompt;
  }
  if (params.negative_prompt !== undefined) {
    updateParams.negative_prompt = params.negative_prompt;
  }
  if (params.seed !== undefined) {
    updateParams.seed = params.seed;
  }
  if (params.guidance_scale !== undefined) {
    updateParams.guidance_scale = params.guidance_scale;
  }
  if (params.num_inference_steps !== undefined) {
    updateParams.num_inference_steps = params.num_inference_steps;
  }
  if (params.t_index_list !== undefined) {
    updateParams.t_index_list = params.t_index_list;
  }
  if (params.model_id !== undefined) {
    updateParams.model_id = params.model_id;
  }
  if (params.controlnets !== undefined && params.controlnets.length > 0) {
    updateParams.controlnets = params.controlnets;
  }

  const body = {
    pipeline: 'streamdiffusion',
    params: updateParams,
  };

  console.log(`Updating stream ${sanitizeForLog(streamId)} with:`, JSON.stringify(body, null, 2));

  const response = await fetch(`${DAYDREAM_API}/v1/streams/${streamId}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error(`Update stream error for ${sanitizeForLog(streamId)}:`, response.status, sanitizeForLog(errorText));
    throw new Error(`Failed to update stream: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  console.log(`Stream ${sanitizeForLog(streamId)} updated successfully`);
  return result;
}

/**
 * Get stream status
 */
export async function getStreamStatus(apiKey: string, streamId: string): Promise<unknown> {
  validateStreamId(streamId);
  const response = await fetch(`${DAYDREAM_API}/v1/streams/${streamId}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to get stream status: ${response.status} ${errorText}`);
  }

  return response.json();
}

/**
 * Delete/end a stream
 */
export async function deleteStream(apiKey: string, streamId: string): Promise<void> {
  validateStreamId(streamId);
  const response = await fetch(`${DAYDREAM_API}/v1/streams/${streamId}`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
  });

  if (!response.ok && response.status !== 404) {
    const errorText = await response.text();
    throw new Error(`Failed to delete stream: ${response.status} ${errorText}`);
  }
}

/**
 * Build default controlnet configurations with all disabled (conditioning_scale = 0)
 */
export function buildDefaultControlnets(modelId?: string): ControlNetConfig[] {
  const controlnets = modelId ? getControlnetsForModel(modelId) : CONTROLNETS_SD15;
  return controlnets.map((cn) => ({
    conditioning_scale: 0,
    control_guidance_end: 1,
    control_guidance_start: 0,
    enabled: true,
    model_id: cn.model_id,
    preprocessor: cn.preprocessor,
    preprocessor_params: cn.preprocessor_params,
  }));
}

/**
 * Build controlnet configs from simplified slider values
 */
export function buildControlnetsFromSliders(
  sliders: Record<string, number>,
  modelId?: string
): ControlNetConfig[] {
  const controlnets = modelId ? getControlnetsForModel(modelId) : CONTROLNETS_SD15;
  return controlnets.map((cn) => ({
    conditioning_scale: sliders[cn.name] || 0,
    control_guidance_end: 1,
    control_guidance_start: 0,
    enabled: true,
    model_id: cn.model_id,
    preprocessor: cn.preprocessor,
    preprocessor_params: cn.preprocessor_params,
  }));
}

/**
 * Preset configurations for quick effects
 */
export const PRESETS = {
  'anime': {
    prompt: 'anime style, vibrant colors, detailed',
    negative_prompt: 'realistic, photo, blurry',
    seed: 42,
    controlnets: { pose: 0.3, edge: 0.2, canny: 0, depth: 0.4 },
  },
  'comic': {
    prompt: 'comic book style, bold lines, dramatic',
    negative_prompt: 'realistic, photo, soft',
    seed: 123,
    controlnets: { pose: 0, edge: 0.4, canny: 0.5, depth: 0 },
  },
  'dream': {
    prompt: 'dreamy, ethereal, soft glow, magical',
    negative_prompt: 'harsh, sharp, realistic',
    seed: 777,
    controlnets: { pose: 0, edge: 0.5, canny: 0, depth: 0.4 },
  },
  'neon': {
    prompt: 'neon lights, cyberpunk, glowing, futuristic',
    negative_prompt: 'natural, soft, muted',
    seed: 2077,
    controlnets: { pose: 0, edge: 0.6, canny: 0.3, depth: 0 },
  },
};
