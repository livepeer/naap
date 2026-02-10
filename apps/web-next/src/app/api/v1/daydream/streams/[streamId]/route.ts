/**
 * Daydream Stream API Routes (per-stream)
 * GET    /api/v1/daydream/streams/[streamId] - Get stream status
 * PATCH  /api/v1/daydream/streams/[streamId] - Update stream parameters
 * DELETE /api/v1/daydream/streams/[streamId] - End/delete a stream
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

// GET — Get stream status from Daydream.live API
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ streamId: string }> }
): Promise<NextResponse> {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    const apiKey = await getUserApiKey(user.id);
    const { streamId } = await params;

    const daydreamResponse = await fetch(`${DAYDREAM_API}/v1/streams/${streamId}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!daydreamResponse.ok) {
      const errorText = await daydreamResponse.text();
      console.error('Get stream status error:', daydreamResponse.status, errorText);
      return errors.internal('Failed to get stream status');
    }

    const status = await daydreamResponse.json();

    return success(status);
  } catch (err) {
    console.error('Error getting stream status:', err);
    return errors.internal('Failed to get stream status');
  }
}

// PATCH — Update stream parameters via Daydream.live API
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ streamId: string }> }
): Promise<NextResponse> {
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
    const { streamId } = await params;
    const body = await request.json();

    if (!body || Object.keys(body).length === 0) {
      return success({ message: 'No parameters to update' });
    }

    // Build the params object — only include what's provided
    const updateParams: Record<string, unknown> = {};
    const allowedFields = [
      'prompt', 'negative_prompt', 'seed', 'guidance_scale',
      'num_inference_steps', 't_index_list', 'model_id', 'controlnets',
    ];
    for (const field of allowedFields) {
      if (body[field] !== undefined) {
        updateParams[field] = body[field];
      }
    }

    const daydreamResponse = await fetch(`${DAYDREAM_API}/v1/streams/${streamId}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pipeline: 'streamdiffusion',
        params: updateParams,
      }),
    });

    if (!daydreamResponse.ok) {
      const errorText = await daydreamResponse.text();
      console.error(`Update stream error for ${streamId}:`, daydreamResponse.status, errorText);
      return errors.internal('Failed to update stream parameters');
    }

    return success({ message: 'Stream parameters updated' });
  } catch (err) {
    console.error('Error updating stream:', err);
    return errors.internal('Failed to update stream parameters');
  }
}

// DELETE — End/delete a stream via Daydream.live API
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ streamId: string }> }
): Promise<NextResponse> {
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
    const { streamId } = await params;

    // Delete from Daydream.live
    const daydreamResponse = await fetch(`${DAYDREAM_API}/v1/streams/${streamId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    if (!daydreamResponse.ok && daydreamResponse.status !== 404) {
      const errorText = await daydreamResponse.text();
      console.error(`Delete stream error for ${streamId}:`, daydreamResponse.status, errorText);
      return errors.internal('Failed to end stream');
    }

    // End session in our database
    const session = await prisma.daydreamSession.findFirst({
      where: { streamId, status: 'active' },
    });

    let durationMins = 0;
    if (session) {
      const endedAt = new Date();
      const durationMs = endedAt.getTime() - session.startedAt.getTime();
      durationMins = Math.round((durationMs / 1000 / 60) * 100) / 100;

      await prisma.daydreamSession.update({
        where: { id: session.id },
        data: {
          endedAt,
          durationMins,
          status: 'ended',
        },
      });
    }

    return success({
      sessionEnded: !!session,
      durationMins,
    });
  } catch (err) {
    console.error('Error ending stream:', err);
    return errors.internal('Failed to end stream');
  }
}
