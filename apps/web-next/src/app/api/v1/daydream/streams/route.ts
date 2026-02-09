/**
 * Daydream Streams API Route
 * POST /api/v1/daydream/streams - Create a new stream via Daydream.live API
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

const DAYDREAM_API = 'https://api.daydream.live';

/**
 * Get user's Daydream API key, with backward-compat migration from 'default-user'
 */
async function getUserApiKey(userId: string): Promise<string> {
  let settings = await prisma.daydreamSettings.findUnique({
    where: { userId },
  });

  // Backward compat: keys saved before auth was fixed used 'default-user'
  if (!settings?.apiKey && userId !== 'default-user') {
    const defaultSettings = await prisma.daydreamSettings.findUnique({
      where: { userId: 'default-user' },
    });
    if (defaultSettings?.apiKey) {
      settings = await prisma.daydreamSettings.upsert({
        where: { userId },
        update: {
          apiKey: defaultSettings.apiKey,
          defaultPrompt: defaultSettings.defaultPrompt,
          defaultSeed: defaultSettings.defaultSeed,
          negativePrompt: defaultSettings.negativePrompt,
        },
        create: {
          userId,
          apiKey: defaultSettings.apiKey,
          defaultPrompt: defaultSettings.defaultPrompt || 'superman',
          defaultSeed: defaultSettings.defaultSeed || 42,
          negativePrompt: defaultSettings.negativePrompt || 'blurry, low quality, flat, 2d',
        },
      });
    }
  }

  if (!settings?.apiKey) {
    throw new Error('No Daydream API key configured. Go to Settings to add your API key.');
  }

  return settings.apiKey;
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

    const apiKey = await getUserApiKey(user.id);
    const body = await request.json();
    const { prompt, seed, model_id, negative_prompt } = body;

    // Get user's default settings
    const settings = await prisma.daydreamSettings.findUnique({
      where: { userId: user.id },
    });

    // Build params with user defaults
    const streamParams = {
      prompt: prompt || settings?.defaultPrompt || 'cinematic, high quality',
      seed: seed || settings?.defaultSeed || 42,
      model_id: model_id || 'stabilityai/sd-turbo',
      negative_prompt: negative_prompt || settings?.negativePrompt || 'blurry, low quality, flat, 2d',
    };

    // Call Daydream.live API
    const daydreamResponse = await fetch(`${DAYDREAM_API}/v1/streams`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pipeline: 'streamdiffusion',
        params: streamParams,
      }),
    });

    if (!daydreamResponse.ok) {
      const errorText = await daydreamResponse.text();
      console.error('Create stream error:', daydreamResponse.status, errorText);
      return errors.internal(`Failed to create stream: ${daydreamResponse.status}`);
    }

    const daydreamResult = await daydreamResponse.json();

    // Record session in our database
    const session = await prisma.daydreamSession.create({
      data: {
        userId: user.id,
        streamId: daydreamResult.id,
        playbackId: daydreamResult.output_playback_id,
        whipUrl: daydreamResult.whip_url,
        prompt: streamParams.prompt,
        seed: streamParams.seed,
        status: 'active',
      },
    });

    return success({
      sessionId: session.id,
      streamId: daydreamResult.id,
      playbackId: daydreamResult.output_playback_id,
      whipUrl: daydreamResult.whip_url,
      params: streamParams,
    });
  } catch (err: any) {
    console.error('Error creating stream:', err);
    const message = err?.message || 'Failed to create stream';
    if (message.includes('API key')) {
      return errors.badRequest(message);
    }
    return errors.internal(message);
  }
}
