/**
 * Daydream Sessions API Routes
 * GET /api/v1/daydream/sessions - Get session history
 * POST /api/v1/daydream/sessions - Create new session
 */

import {NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken, parsePagination } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

// Default API key (users can override in settings)
const DEFAULT_API_KEY = 'sk_McV4YRwF1gTVS6WEyBr4RQhnkFq4zh1revzVHpyYVzsKWa1eHT4KgxNKGyi1pUKB';
const DAYDREAM_API_BASE = 'https://api.daydream.live/v1';

async function getApiKey(userId: string): Promise<string> {
  try {
    const settings = await prisma.daydreamSettings.findUnique({
      where: { userId },
    });
    return settings?.apiKey || DEFAULT_API_KEY;
  } catch {
    return DEFAULT_API_KEY;
  }
}

async function createDaydreamStream(apiKey: string, params: Record<string, unknown>) {
  const response = await fetch(`${DAYDREAM_API_BASE}/streams`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(params),
  });

  if (!response.ok) {
    throw new Error(`Daydream API error: ${response.status}`);
  }

  return response.json();
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    const searchParams = request.nextUrl.searchParams;
    const { page, pageSize, skip } = parsePagination(searchParams);

    const [sessions, total] = await Promise.all([
      prisma.daydreamSession.findMany({
        where: { userId: user.id },
        orderBy: { startedAt: 'desc' },
        take: pageSize,
        skip,
      }),
      prisma.daydreamSession.count({
        where: { userId: user.id },
      }),
    ]);

    return success(
      { sessions },
      { page, pageSize, total, totalPages: Math.ceil(total / pageSize) }
    );
  } catch (err) {
    console.error('Error getting sessions:', err);
    return errors.internal('Failed to get sessions');
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const csrfError = validateCSRF(request, token);
    if (csrfError) {
      return csrfError;
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    const body = await request.json();
    const { prompt, seed, model_id, negative_prompt } = body;

    const apiKey = await getApiKey(user.id);

    // Get user's default settings
    const settings = await prisma.daydreamSettings.findUnique({
      where: { userId: user.id },
    });

    // Build initial params with user defaults
    const initialParams = {
      prompt: prompt || settings?.defaultPrompt || 'cinematic, high quality',
      seed: seed || settings?.defaultSeed || 42,
      model_id: model_id || 'stabilityai/sd-turbo',
      negative_prompt: negative_prompt || settings?.negativePrompt || 'blurry, low quality, flat, 2d',
    };

    // Create stream via Daydream API
    const streamResponse = await createDaydreamStream(apiKey, initialParams);

    // Record session
    const session = await prisma.daydreamSession.create({
      data: {
        userId: user.id,
        streamId: streamResponse.id,
        playbackId: streamResponse.output_playback_id,
        whipUrl: streamResponse.whip_url,
        prompt: initialParams.prompt,
        seed: initialParams.seed,
      },
    });

    return success({
      sessionId: session.id,
      streamId: streamResponse.id,
      playbackId: streamResponse.output_playback_id,
      whipUrl: streamResponse.whip_url,
      params: initialParams,
    });
  } catch (err) {
    console.error('Error creating session:', err);
    return errors.internal('Failed to create session');
  }
}
