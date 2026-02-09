/**
 * Daydream Models API Route
 * GET /api/v1/daydream/models - List available AI models
 *
 * Public route (no auth required). If user is authenticated and has an API key,
 * tries to fetch dynamic models from Daydream API; otherwise returns built-in list.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { success, getAuthToken } from '@/lib/api/response';

const DAYDREAM_API = 'https://api.daydream.live';

// Built-in fallback model list (matches Daydream API documentation)
const MODELS = [
  {
    id: 'stabilityai/sd-turbo',
    name: 'SD Turbo',
    description: 'Fast SD model, optimized for real-time',
    controlnetPrefix: 'lllyasviel/sd-controlnet',
  },
  {
    id: 'stabilityai/sdxl-turbo',
    name: 'SDXL Turbo',
    description: 'High quality SDXL model',
    controlnetPrefix: 'diffusers/controlnet-canny-sdxl-1.0',
  },
  {
    id: 'prompthero/openjourney-v4',
    name: 'OpenJourney v4',
    description: 'Artistic SD 1.5 model',
    controlnetPrefix: 'lllyasviel/sd-controlnet',
  },
  {
    id: 'Lykon/dreamshaper-8',
    name: 'DreamShaper 8',
    description: 'Versatile SD 1.5 model',
    controlnetPrefix: 'lllyasviel/sd-controlnet',
  },
];

export async function GET(request: NextRequest): Promise<NextResponse> {
  try {
    // Try to get user's API key for dynamic model list (auth is optional)
    const token = getAuthToken(request);
    if (token) {
      const user = await validateSession(token);
      if (user) {
        const settings = await prisma.daydreamSettings.findUnique({
          where: { userId: user.id },
        });
        if (settings?.apiKey) {
          try {
            const response = await fetch(`${DAYDREAM_API}/v1/models`, {
              headers: { Authorization: `Bearer ${settings.apiKey}` },
            });

            if (response.ok) {
              const data = await response.json();
              const models = Array.isArray(data)
                ? data
                : data.models || data.data || MODELS;
              if (Array.isArray(models) && models.length > 0 && models[0].id) {
                return success(models);
              }
            }
          } catch {
            // Fall through to default list
          }
        }
      }
    }
  } catch {
    // Fall through to default list
  }

  return success(MODELS);
}
