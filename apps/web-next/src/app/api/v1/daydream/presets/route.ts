/**
 * Daydream Presets API Route
 * GET /api/v1/daydream/presets - List preset configurations for quick effects
 *
 * Public route (no auth required). Returns static reference data.
 */

import { NextRequest, NextResponse } from 'next/server';
import { success } from '@/lib/api/response';

const PRESETS = {
  anime: {
    prompt: 'anime style, vibrant colors, detailed',
    negative_prompt: 'realistic, photo, blurry',
    seed: 42,
    controlnets: { pose: 0.3, edge: 0.2, canny: 0, depth: 0.4 },
  },
  comic: {
    prompt: 'comic book style, bold lines, dramatic',
    negative_prompt: 'realistic, photo, soft',
    seed: 123,
    controlnets: { pose: 0, edge: 0.4, canny: 0.5, depth: 0 },
  },
  dream: {
    prompt: 'dreamy, ethereal, soft glow, magical',
    negative_prompt: 'harsh, sharp, realistic',
    seed: 777,
    controlnets: { pose: 0, edge: 0.5, canny: 0, depth: 0.4 },
  },
  neon: {
    prompt: 'neon lights, cyberpunk, glowing, futuristic',
    negative_prompt: 'natural, soft, muted',
    seed: 2077,
    controlnets: { pose: 0, edge: 0.6, canny: 0.3, depth: 0 },
  },
};

export async function GET(_request: NextRequest): Promise<NextResponse> {
  return success(PRESETS);
}
