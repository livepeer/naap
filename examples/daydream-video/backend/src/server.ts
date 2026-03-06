/**
 * Daydream AI Video Plugin - Backend Server
 *
 * Upstream Daydream API calls are routed through the Service Gateway
 * connector (/api/v1/gw/daydream/*), which handles API key injection
 * from SecretVault. This backend only manages NaaP-internal concerns:
 * sessions, settings, usage, WHIP proxy, and reference data.
 */

import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import type { Request } from 'express';
import { createPluginServer, createExternalProxy } from '@naap/plugin-server-sdk';
import { prisma } from './db/client.js';

/** Sanitize a value for safe log output (prevents log injection) */
function sanitizeForLog(value: unknown): string {
  return String(value).replace(/[\n\r\t\x00-\x1f\x7f-\x9f]/g, '');
}
import {
  MODELS,
  CONTROLNETS_SD15,
  getControlnetsForModel,
  PRESETS,
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

/**
 * Note: Upstream Daydream API calls go through the Service Gateway
 * connector (/api/v1/gw/daydream/*), which auto-injects the API key
 * from SecretVault. This backend only handles NaaP-internal concerns
 * (sessions, settings, usage, reference data).
 */

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

// Test connector by calling gateway health check (models endpoint)
router.post(`${API_PREFIX}/settings/test`, async (req, res) => {
  try {
    const token = req.headers.authorization;
    if (!token) {
      return res.status(401).json({
        success: false,
        error: { message: 'Authentication required' },
      });
    }

    // Call the gateway connector's models endpoint to verify the key works
    const gwBase = process.env.NAAP_SHELL_URL || 'http://localhost:3000';
    const response = await fetch(`${gwBase}/api/v1/gw/daydream/models`, {
      headers: { Authorization: token },
    });

    if (!response.ok) {
      const body = await response.text();
      return res.status(400).json({
        success: false,
        error: { message: `Gateway health check failed (${response.status}): ${body}` },
      });
    }

    res.json({
      success: true,
      message: 'Daydream connector is working',
    });
  } catch (error) {
    console.error('Connector test failed:', error);
    res.status(400).json({
      success: false,
      error: { message: 'Failed to reach Daydream via gateway connector.' },
    });
  }
});

// ==================== Session Recording ==============================
// Stream CRUD goes through the gateway connector (/api/v1/gw/daydream).
// These endpoints let the frontend record / end NaaP-internal sessions
// after the gateway call succeeds.

router.post(`${API_PREFIX}/sessions`, async (req, res) => {
  try {
    const userId = getUserId(req);
    const { streamId, playbackId, whipUrl, prompt, seed } = req.body;
    if (!streamId) {
      return res.status(400).json({ success: false, error: { message: 'streamId is required' } });
    }

    const session = await startSession({
      userId,
      streamId,
      playbackId: playbackId || '',
      whipUrl: whipUrl || '',
      prompt: prompt || 'cinematic, high quality',
      seed: seed || 42,
    });

    res.json({ success: true, data: { sessionId: session.id, streamId } });
  } catch (error) {
    console.error('Error recording session:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to record session' } });
  }
});

router.post(`${API_PREFIX}/sessions/end-by-stream/:streamId`, async (req, res) => {
  try {
    const { streamId } = req.params;
    const session = await endSessionByStreamId(streamId);
    res.json({
      success: true,
      data: { sessionEnded: !!session, durationMins: session?.durationMins || 0 },
    });
  } catch (error) {
    console.error('Error ending session:', error);
    res.status(500).json({ success: false, error: { message: 'Failed to end session' } });
  }
});

// ==================== WHIP Proxy ====================
// Proxies the WebRTC WHIP SDP handshake through the backend to avoid CORS.
// The actual WebRTC media stream goes peer-to-peer; only the initial SDP
// offer/answer exchange needs this proxy. Auth is validated by the gateway
// connector on the stream-creation step; here we only check the user is
// authenticated to NaaP.

router.post(
  `${API_PREFIX}/whip-proxy`,
  ...createExternalProxy({
    allowedHosts: ['ai.livepeer.com', 'livepeer.studio', 'api.daydream.live'],
    targetUrlHeader: 'X-WHIP-URL',
    contentType: 'application/sdp',
    exposeHeaders: [{ from: 'Location', to: 'X-WHIP-Resource' }],
    timeout: 30_000,
    authorize: async (req) => {
      getUserId(req);
      return true;
    },
  })
);

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
    console.error('Error ending session:', sanitizeForLog(error));
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

// Models - return built-in list (live list available via gateway: /api/v1/gw/daydream/models)
router.get(`${API_PREFIX}/models`, async (_req, res) => {
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
  console.log(`   Upstream: via gateway connector /api/v1/gw/daydream/*`);
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
