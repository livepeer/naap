/**
 * Daydream ControlNets API Route
 * GET /api/v1/daydream/controlnets - List available ControlNet configurations
 *
 * Public route (no auth required). Returns static reference data.
 * Supports ?model_id= query param to return model-specific controlnets.
 */

import { NextRequest, NextResponse } from 'next/server';
import { success } from '@/lib/api/response';

// ControlNet configurations for SD 1.5 / SD Turbo
const CONTROLNETS_SD15 = [
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
const CONTROLNETS_SDXL = [
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

function getControlnetsForModel(modelId: string) {
  if (modelId.includes('sdxl')) {
    return CONTROLNETS_SDXL;
  }
  return CONTROLNETS_SD15;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const modelId = request.nextUrl.searchParams.get('model_id');
  const controlnets = modelId ? getControlnetsForModel(modelId) : CONTROLNETS_SD15;
  return success(controlnets);
}
