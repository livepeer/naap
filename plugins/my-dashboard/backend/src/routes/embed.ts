/**
 * Embed Routes - Generate signed embed URLs
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../db/client.js';
import { generateEmbedUrl, verifyConfig } from '../services/metabase.js';

const router = Router();

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
    const params: Record<string, string> = {};
    for (const [key, value] of Object.entries(req.query)) {
      if (key.startsWith('param_') && typeof value === 'string') {
        params[key.replace('param_', '')] = value;
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
