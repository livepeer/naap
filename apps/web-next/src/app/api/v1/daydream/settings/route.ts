/**
 * Daydream Settings API Routes
 * GET /api/v1/daydream/settings - Get user settings
 * POST /api/v1/daydream/settings - Update user settings
 */

import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

export async function GET(request: NextRequest) {
  try {
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    let settings = await prisma.daydreamSettings.findUnique({
      where: { userId: user.id },
    });

    if (!settings) {
      settings = await prisma.daydreamSettings.create({
        data: { userId: user.id },
      });
    }

    return success({
      hasApiKey: !!settings.apiKey,
      defaultPrompt: settings.defaultPrompt,
      defaultSeed: settings.defaultSeed,
      negativePrompt: settings.negativePrompt,
    });
  } catch (err) {
    console.error('Error getting settings:', err);
    return errors.internal('Failed to get settings');
  }
}

export async function POST(request: NextRequest) {
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
    const { apiKey, defaultPrompt, defaultSeed, negativePrompt } = body;

    const settings = await prisma.daydreamSettings.upsert({
      where: { userId: user.id },
      update: {
        ...(apiKey !== undefined && { apiKey }),
        ...(defaultPrompt !== undefined && { defaultPrompt }),
        ...(defaultSeed !== undefined && { defaultSeed }),
        ...(negativePrompt !== undefined && { negativePrompt }),
      },
      create: {
        userId: user.id,
        apiKey,
        defaultPrompt: defaultPrompt || 'superman',
        defaultSeed: defaultSeed || 42,
        negativePrompt: negativePrompt || 'blurry, low quality, flat, 2d',
      },
    });

    return success({
      hasApiKey: !!settings.apiKey,
      defaultPrompt: settings.defaultPrompt,
      defaultSeed: settings.defaultSeed,
      negativePrompt: settings.negativePrompt,
    });
  } catch (err) {
    console.error('Error updating settings:', err);
    return errors.internal('Failed to update settings');
  }
}
