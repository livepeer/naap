/**
 * Configuration Routes (Admin only)
 */

import { Router, Request, Response } from 'express';
import { getConfig, saveConfig, verifyConfig } from '../services/metabase.js';

const router = Router();

// GET /config - Get plugin configuration
router.get('/config', async (req: Request, res: Response) => {
  try {
    const config = await getConfig();
    
    // Mask the secret key for security
    const maskedConfig = {
      ...config,
      metabaseSecretKey: config.metabaseSecretKey 
        ? `${config.metabaseSecretKey.substring(0, 8)}...` 
        : '',
    };

    res.json({
      success: true,
      data: maskedConfig,
    });
  } catch (error) {
    console.error('Error fetching config:', error);
    res.status(500).json({
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch configuration' },
    });
  }
});

// PUT /config - Update plugin configuration
router.put('/config', async (req: Request, res: Response) => {
  try {
    const { metabaseUrl, metabaseSecretKey, tokenExpiry, enableInteractive } = req.body;

    const updates: Record<string, string | number | boolean> = {};
    
    if (metabaseUrl !== undefined) updates.metabaseUrl = metabaseUrl;
    if (metabaseSecretKey !== undefined) updates.metabaseSecretKey = metabaseSecretKey;
    if (tokenExpiry !== undefined) updates.tokenExpiry = tokenExpiry;
    if (enableInteractive !== undefined) updates.enableInteractive = enableInteractive;

    await saveConfig(updates);

    // Verify the new config
    const status = await verifyConfig();

    res.json({
      success: true,
      data: {
        saved: true,
        valid: status.valid,
        validationMessage: status.error,
      },
    });
  } catch (error) {
    console.error('Error saving config:', error);
    res.status(500).json({
      success: false,
      error: { code: 'SAVE_ERROR', message: 'Failed to save configuration' },
    });
  }
});

// POST /config/test - Test Metabase connection
router.post('/config/test', async (req: Request, res: Response) => {
  try {
    const status = await verifyConfig();
    
    if (!status.valid) {
      return res.json({
        success: true,
        data: {
          connected: false,
          error: status.error,
        },
      });
    }

    // Could add actual Metabase API ping here
    res.json({
      success: true,
      data: {
        connected: true,
        message: 'Configuration is valid',
      },
    });
  } catch (error) {
    console.error('Error testing config:', error);
    res.status(500).json({
      success: false,
      error: { code: 'TEST_ERROR', message: 'Failed to test configuration' },
    });
  }
});

export { router as configRoutes };
