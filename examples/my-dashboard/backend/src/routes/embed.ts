/**
 * Embed Routes - Generate signed embed URLs
 */

import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../db/client.js';
import { generateEmbedUrl, verifyConfig } from '../services/metabase.js';

const router = Router();

// Rate limiting to prevent abuse
const rateLimitMap = new Map<string, { count: number; resetTime: number }>();
function createRateLimiter(windowMs: number, maxRequests: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip || 'unknown';
    const now = Date.now();
    const entry = rateLimitMap.get(key);
    if (!entry || now > entry.resetTime) {
      rateLimitMap.set(key, { count: 1, resetTime: now + windowMs });
      return next();
    }
    if (entry.count >= maxRequests) {
      return res.status(429).json({ error: 'Too many requests, please try again later' });
    }
    entry.count++;
    return next();
  };
}
router.use(createRateLimiter(15 * 60 * 1000, 200));

// GET /embed/:id - Get signed embed URL for a dashboard
router.get('/embed/:id', async (req: Request, res: Response) => {
  try {
    // Verify Metabase is configured
    const configStatus = await verifyConfig();
    if (!configStatus.valid) {
      return res.status(503).json({
        success: false,
        error: { code: 'NOT_CONFIGURED', message: configStatus.error },
      });
    }

    // Find the dashboard
    const dashboard = await prisma.dashboard.findUnique({
      where: { id: req.params.id },
    });

    if (!dashboard) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Dashboard not found' },
      });
    }

    // Get user ID from auth if available
    const userId = (req as any).user?.id;

    // Parse any filter params from query string
    const UNSAFE_KEYS = ['__proto__', 'constructor', 'prototype'];
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.query)) {
      if (key.startsWith('param_') && typeof value === 'string') {
        const paramKey = key.replace('param_', '');
        if (UNSAFE_KEYS.includes(paramKey)) continue;
        params[paramKey] = value;
      }
    }

    // Generate signed embed URL
    const embed = await generateEmbedUrl(
      dashboard.metabaseId,
      Object.keys(params).length > 0 ? params : undefined,
      userId
    );

    res.json({
      success: true,
      data: embed,
    });
  } catch (error) {
    console.error('Error generating embed URL:', error);
    res.status(500).json({
      success: false,
      error: { code: 'EMBED_ERROR', message: 'Failed to generate embed URL' },
    });
  }
});

// GET /embed/verify - Verify Metabase configuration
router.get('/embed/verify', async (req: Request, res: Response) => {
  try {
    const status = await verifyConfig();
    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    console.error('Error verifying config:', error);
    res.status(500).json({
      success: false,
      error: { code: 'VERIFY_ERROR', message: 'Failed to verify configuration' },
    });
  }
});

export { router as embedRoutes };
