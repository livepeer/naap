/**
 * User Preferences Routes
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../db/client.js';

const router = Router();

// Helper to get user ID from request
const getUserId = (req: Request): string | null => {
  return (req as any).user?.id || req.headers['x-user-id'] as string || null;
};

// GET /preferences - Get user's dashboard preferences
router.get('/preferences', async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'User ID required' },
      });
    }

    const preferences = await prisma.dashboardUserPreference.findMany({
      where: { userId },
      orderBy: { order: 'asc' },
    });

    res.json({
      success: true,
      data: preferences,
    });
  } catch (error) {
    console.error('Error fetching preferences:', error);
    res.status(500).json({
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch preferences' },
    });
  }
});

// PUT /preferences - Update user's dashboard preferences
router.put('/preferences', async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'User ID required' },
      });
    }

    const { dashboardId, pinned, order } = req.body;

    if (!dashboardId) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'dashboardId is required' },
      });
    }

    const preference = await prisma.dashboardUserPreference.upsert({
      where: {
        userId_dashboardId: { userId, dashboardId },
      },
      update: {
        pinned: pinned !== undefined ? pinned : undefined,
        order: order !== undefined ? order : undefined,
      },
      create: {
        userId,
        dashboardId,
        pinned: pinned ?? true,
        order: order ?? 0,
      },
    });

    res.json({
      success: true,
      data: preference,
    });
  } catch (error) {
    console.error('Error updating preferences:', error);
    res.status(500).json({
      success: false,
      error: { code: 'UPDATE_ERROR', message: 'Failed to update preferences' },
    });
  }
});

// PUT /preferences/bulk - Bulk update preferences (for reordering)
router.put('/preferences/bulk', async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'User ID required' },
      });
    }

    const { preferences } = req.body;

    if (!Array.isArray(preferences)) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'preferences array is required' },
      });
    }

    // Update each preference in a transaction
    await prisma.$transaction(
      preferences.map((pref: { dashboardId: string; order: number; pinned?: boolean }) =>
        prisma.dashboardUserPreference.upsert({
          where: {
            userId_dashboardId: { userId, dashboardId: pref.dashboardId },
          },
          update: {
            order: pref.order,
            pinned: pref.pinned,
          },
          create: {
            userId,
            dashboardId: pref.dashboardId,
            order: pref.order,
            pinned: pref.pinned ?? true,
          },
        })
      )
    );

    res.json({
      success: true,
      data: { updated: preferences.length },
    });
  } catch (error) {
    console.error('Error bulk updating preferences:', error);
    res.status(500).json({
      success: false,
      error: { code: 'UPDATE_ERROR', message: 'Failed to update preferences' },
    });
  }
});

// DELETE /preferences/:dashboardId - Remove a preference
router.delete('/preferences/:dashboardId', async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    
    if (!userId) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: 'User ID required' },
      });
    }

    await prisma.dashboardUserPreference.delete({
      where: {
        userId_dashboardId: { userId, dashboardId: req.params.dashboardId },
      },
    });

    res.json({
      success: true,
      data: { deleted: true },
    });
  } catch (error) {
    console.error('Error deleting preference:', error);
    res.status(500).json({
      success: false,
      error: { code: 'DELETE_ERROR', message: 'Failed to delete preference' },
    });
  }
});

export { router as preferencesRoutes };
