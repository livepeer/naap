/**
 * Daydream AI Video Plugin - Backend Server
 *
 * Proxies to the Daydream.live StreamDiffusion API using the user's API key.
 * API Docs: https://docs.daydream.live/quickstart
 */

import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import type { Request } from 'express';
import { createPluginServer, createExternalProxy } from '@naap/plugin-server-sdk';
import { prisma } from './db/client.js';
import {
  createStream as daydreamCreateStream,
  updateStreamParams as daydreamUpdateParams,
  getStreamStatus as daydreamGetStatus,
  deleteStream as daydreamDeleteStream,
  listModels,
  MODELS,
  CONTROLNETS_SD15,
  CONTROLNETS_SDXL,
  getControlnetsForModel,
  PRESETS,
  type StreamParams,
} from './services/daydream.js';
import {
  startSession,
  endSession,
  endSessionByStreamId,
  getUsageStats,
  getSessionHistory,
  getActiveSession,
  cleanupStaleSessions,
} from './services/sessions.js';

dotenv.config();

const pluginConfig = JSON.parse(
  readFileSync(new URL('../../plugin.json', import.meta.url), 'utf8')
);
const PORT = process.env.PORT || pluginConfig.backend?.devPort || 4111;
const API_PREFIX = '/daydream';

const { router, start, stop } = createPluginServer({
  name: 'daydream-video',
  port: Number(PORT),
  publicRoutes: [
    '/healthz',
    // Read-only reference data endpoints (no auth needed for initial page load)
    '/api/v1/daydream/models',
    '/api/v1/daydream/controlnets',
    '/api/v1/daydream/presets',
    '/daydream/models',
    '/daydream/controlnets',
    '/daydream/presets',
    // NOTE: /settings removed from public routes so userId is consistent.
    // The frontend sends auth tokens via localStorage, so this works fine.
  ],
});

// Helper to get user ID from request
function getUserId(req: Request): string {
  const userId = (req as any).user?.id;
  if (userId) return userId;
  if (process.env.NODE_ENV !== 'production') return 'default-user';
  throw new Error('Authentication required');
}

// Helper to get user's Daydream API key
async function getUserApiKey(userId: string): Promise<string> {
  // Try the actual user ID first
  let settings = await prisma.daydreamSettings.findUnique({
    where: { userId },
  });

  // Backward compat: keys saved before auth was fixed used 'default-user'
  // If no key for this user, check the default and migrate it
  if (!settings?.apiKey && userId !== 'default-user') {
    const defaultSettings = await prisma.daydreamSettings.findUnique({
      where: { userId: 'default-user' },
    });
    if (defaultSettings?.apiKey) {
      // Migrate the key to the real user
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
      console.log(`[daydream] Migrated API key from default-user to ${userId}`);
    }
  }

  if (!settings?.apiKey) {
    throw new Error('No Daydream API key configured. Go to Settings to add your API key.');
  }

  return settings.apiKey;
}

// ==================== Settings Endpoints ====================

// Get user settings
router.get(`${API_PREFIX}/settings`, async (req, res) => {
  try {
    const userId = getUserId(req);

    let settings = await prisma.daydreamSettings.findUnique({
      where: { userId },
    });

    if (!settings) {
      settings = await prisma.daydreamSettings.create({
        data: { userId },
      });
    }

    res.json({
      success: true,
      data: {
        hasApiKey: !!settings.apiKey,
        defaultPrompt: settings.defaultPrompt,
        defaultSeed: settings.defaultSeed,
        negativePrompt: settings.negativePrompt,
      },
    });
  } catch (error) {
    console.error('Error getting settings:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get settings' },
    });
  }
});

// Update user settings
router.post(`${API_PREFIX}/settings`, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { apiKey, defaultPrompt, defaultSeed, negativePrompt } = req.body;

    const settings = await prisma.daydreamSettings.upsert({
      where: { userId },
      update: {
        ...(apiKey !== undefined && { apiKey }),
        ...(defaultPrompt !== undefined && { defaultPrompt }),
        ...(defaultSeed !== undefined && { defaultSeed }),
        ...(negativePrompt !== undefined && { negativePrompt }),
      },
      create: {
        userId,
        apiKey,
        defaultPrompt: defaultPrompt || 'superman',
        defaultSeed: defaultSeed || 42,
        negativePrompt: negativePrompt || 'blurry, low quality, flat, 2d',
      },
    });

    res.json({
      success: true,
      data: {
        hasApiKey: !!settings.apiKey,
        defaultPrompt: settings.defaultPrompt,
        defaultSeed: settings.defaultSeed,
        negativePrompt: settings.negativePrompt,
      },
    });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update settings' },
    });
  }
});

// Test API key connection against Daydream.live
router.post(`${API_PREFIX}/settings/test`, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { apiKey: testKey } = req.body;

    // Use provided key or fallback to stored key
    let apiKey = testKey;
    if (!apiKey) {
      const settings = await prisma.daydreamSettings.findUnique({ where: { userId } });
      apiKey = settings?.apiKey;
    }

    if (!apiKey) {
      return res.status(400).json({
        success: false,
        error: { message: 'No API key provided or stored' },
      });
    }

    // Test by listing models from Daydream API
    const models = await listModels(apiKey);
    res.json({
      success: true,
      message: 'Daydream API connection successful',
      data: { modelsAvailable: models.length },
    });
  } catch (error) {
    console.error('API key test failed:', error);
    res.status(400).json({
      success: false,
      error: { message: 'Failed to connect to Daydream API. Check your API key.' },
    });
  }
});

// ==================== Stream Endpoints ====================

// Create a new stream via Daydream.live API
router.post(`${API_PREFIX}/streams`, async (req, res) => {
  try {
    const userId = getUserId(req);
    const apiKey = await getUserApiKey(userId);
    const { prompt, seed, model_id, negative_prompt } = req.body;

    // Get user's default settings
    const settings = await prisma.daydreamSettings.findUnique({
      where: { userId },
    });

    // Build params with user defaults
    const streamParams: Partial<StreamParams> = {
      prompt: prompt || settings?.defaultPrompt || 'cinematic, high quality',
      seed: seed || settings?.defaultSeed || 42,
      model_id: model_id || 'stabilityai/sd-turbo',
      negative_prompt: negative_prompt || settings?.negativePrompt || 'blurry, low quality, flat, 2d',
    };

    // Call Daydream.live API directly
    const daydreamResult = await daydreamCreateStream(apiKey, streamParams);

    // Record session in our database
    const session = await startSession({
      userId,
      streamId: daydreamResult.id,
      playbackId: daydreamResult.output_playback_id,
      whipUrl: daydreamResult.whip_url,
      prompt: streamParams.prompt!,
      seed: streamParams.seed!,
    });

    res.json({
      success: true,
      data: {
        sessionId: session.id,
        streamId: daydreamResult.id,
        playbackId: daydreamResult.output_playback_id,
        whipUrl: daydreamResult.whip_url,
        params: streamParams,
      },
    });
  } catch (error: any) {
    console.error('Error creating stream:', error);
    const message = error?.message || 'Failed to create stream';
    const statusCode = message.includes('API key') ? 400 : 500;
    res.status(statusCode).json({
      success: false,
      error: { message },
    });
  }
});

// ==================== WHIP Proxy ====================
// Proxies the WebRTC WHIP SDP handshake through the backend to avoid CORS.
//
// WHY: The WHIP endpoint (ai.livepeer.com) is a third-party server that
// doesn't set Access-Control-Allow-Origin for localhost or any arbitrary
// origin. Browsers block cross-origin fetch() to it. The actual WebRTC
// media stream goes peer-to-peer and doesn't need this proxy — only the
// initial SDP offer/answer exchange does.
//
// Uses the shared createExternalProxy from @naap/plugin-server-sdk.
// Future plugins that need to call external APIs should use the same
// utility — see plugin-server-sdk docs for details.

router.post(
  `${API_PREFIX}/whip-proxy`,
  ...createExternalProxy({
    allowedHosts: ['ai.livepeer.com', 'livepeer.studio', 'api.daydream.live'],
    targetUrlHeader: 'X-WHIP-URL',
    contentType: 'application/sdp',
    exposeHeaders: [{ from: 'Location', to: 'X-WHIP-Resource' }],
    timeout: 30_000,
    authorize: async (req) => {
      // Verify the user has a valid API key before proxying
      const userId = getUserId(req);
      await getUserApiKey(userId);
      return true;
    },
  })
);

// Update stream parameters via Daydream.live API
router.patch(`${API_PREFIX}/streams/:streamId`, async (req, res) => {
  try {
    const userId = getUserId(req);
    const apiKey = await getUserApiKey(userId);
    const { streamId } = req.params;
    const params = req.body || {};

    if (Object.keys(params).length === 0) {
      return res.json({ success: true, message: 'No parameters to update' });
    }

    await daydreamUpdateParams(apiKey, streamId, params);

    res.json({
      success: true,
      message: 'Stream parameters updated',
    });
  } catch (error) {
    console.error('Error updating stream:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to update stream parameters' },
    });
  }
});

// Get stream status from Daydream.live API
router.get(`${API_PREFIX}/streams/:streamId`, async (req, res) => {
  try {
    const userId = getUserId(req);
    const apiKey = await getUserApiKey(userId);
    const { streamId } = req.params;

    const status = await daydreamGetStatus(apiKey, streamId);

    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error('Error getting stream status:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to get stream status' },
    });
  }
});

// End/delete a stream via Daydream.live API
router.delete(`${API_PREFIX}/streams/:streamId`, async (req, res) => {
  try {
    const userId = getUserId(req);
    const apiKey = await getUserApiKey(userId);
    const { streamId } = req.params;

    // Delete from Daydream.live
    await daydreamDeleteStream(apiKey, streamId);

    // End session in our database
    const session = await endSessionByStreamId(streamId);

    res.json({
      success: true,
      data: {
        sessionEnded: !!session,
        durationMins: session?.durationMins || 0,
      },
    });
  } catch (error) {
    console.error('Error ending stream:', error);
    res.status(500).json({
      success: false,
      error: { message: 'Failed to end stream' },
    });
  }
});

// ==================== Usage Endpoints ====================

router.get(`${API_PREFIX}/usage`, async (req, res) => {
  try {
    const userId = getUserId(req);
    const stats = await getUsageStats(userId);
    res.json({ success: true, data: stats });
  } catch (error) {
    console.error('Error getting usage stats:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to get usage stats' } });
  }
});

router.get(`${API_PREFIX}/sessions`, async (req, res) => {
  try {
    const userId = getUserId(req);
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const sessions = await getSessionHistory(userId, limit, offset);
    res.json({ success: true, data: sessions });
  } catch (error) {
    console.error('Error getting session history:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to get session history' } });
  }
});

router.post(`${API_PREFIX}/sessions/:sessionId/end`, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const session = await endSession(sessionId);
    res.json({ success: true, data: session });
  } catch (error) {
    console.error('Error ending session:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to end session' } });
  }
});

router.get(`${API_PREFIX}/sessions/active`, async (req, res) => {
  try {
    const userId = getUserId(req);
    const session = await getActiveSession(userId);
    res.json({ success: true, data: session });
  } catch (error) {
    console.error('Error getting active session:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to get active session' } });
  }
});

// ==================== Reference Data Endpoints ====================

// Models - try Daydream API, fallback to built-in list
router.get(`${API_PREFIX}/models`, async (req, res) => {
  try {
    // Try to get user's API key for dynamic model list
    const userId = getUserId(req);
    const settings = await prisma.daydreamSettings.findUnique({ where: { userId } });
    if (settings?.apiKey) {
      const models = await listModels(settings.apiKey);
      return res.json({ success: true, data: models });
    }
  } catch {
    // Fall through to default list
  }
  res.json({ success: true, data: MODELS });
});

// ControlNets
router.get(`${API_PREFIX}/controlnets`, (req, res) => {
  const modelId = req.query.model_id as string;
  const controlnets = modelId ? getControlnetsForModel(modelId) : CONTROLNETS_SD15;
  res.json({ success: true, data: controlnets });
});

// Presets
router.get(`${API_PREFIX}/presets`, (_req, res) => {
  res.json({ success: true, data: PRESETS });
});

// ==================== Error Handlers ====================

router.use((req, res) => {
  res.status(404).json({
    success: false,
    error: { code: 'NOT_FOUND', message: 'Endpoint not found' },
  });
});

router.use((err: Error, req: Request, res: any, next: any) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
  });
});

// ==================== Server Startup ====================

start().then(() => {
  console.log(`🎬 Daydream AI Video backend running on port ${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/healthz`);
  console.log(`   API: http://localhost:${PORT}/api/v1${API_PREFIX}`);
  console.log(`   Daydream API: https://api.daydream.live`);
}).catch((err) => {
  console.error('Failed to start daydream-video backend:', err);
  process.exit(1);
});

// Cleanup stale sessions periodically
setInterval(async () => {
  try {
    const cleaned = await cleanupStaleSessions();
    if (cleaned > 0) {
      console.log(`Cleaned up ${cleaned} stale sessions`);
    }
  } catch (error) {
    console.error('Error cleaning up stale sessions:', error);
  }
}, 5 * 60 * 1000);

export default router;
