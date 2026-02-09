/**
 * Dashboard Routes
 */

import { Router, Request, Response } from 'express';
import { prisma } from '../db/client.js';

const router = Router();

// GET /dashboards - List all dashboards
router.get('/dashboards', async (req: Request, res: Response) => {
  try {
    const dashboards = await prisma.dashboard.findMany({
      orderBy: [
        { isDefault: 'desc' },
        { order: 'asc' },
        { name: 'asc' },
      ],
    });

    res.json({
      success: true,
      data: dashboards,
      meta: { total: dashboards.length },
    });
  } catch (error) {
    console.error('Error fetching dashboards:', error);
    res.status(500).json({
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch dashboards' },
    });
  }
});

// GET /dashboards/:id - Get single dashboard
router.get('/dashboards/:id', async (req: Request, res: Response) => {
  try {
    const dashboard = await prisma.dashboard.findUnique({
      where: { id: req.params.id },
    });

    if (!dashboard) {
      return res.status(404).json({
        success: false,
        error: { code: 'NOT_FOUND', message: 'Dashboard not found' },
      });
    }

    res.json({
      success: true,
      data: dashboard,
    });
  } catch (error) {
    console.error('Error fetching dashboard:', error);
    res.status(500).json({
      success: false,
      error: { code: 'FETCH_ERROR', message: 'Failed to fetch dashboard' },
    });
  }
});

// POST /dashboards - Create dashboard (admin only)
router.post('/dashboards', async (req: Request, res: Response) => {
  try {
    const { metabaseId, entityId, name, description, thumbnail, isDefault } = req.body;

    if (!metabaseId || !name) {
      return res.status(400).json({
        success: false,
        error: { code: 'VALIDATION_ERROR', message: 'metabaseId (numeric) and name are required' },
      });
    }

    // Validate metabaseId is a number
    const numericId = parseInt(metabaseId);
    if (isNaN(numericId)) {
      return res.status(400).json({
        success: false,
        error: { 
          code: 'VALIDATION_ERROR', 
          message: 'metabaseId must be a numeric ID. Entity IDs are not supported for embedding. Find the numeric ID in your Metabase dashboard URL (e.g., /dashboard/123)' 
        },
      });
    }

    // Get user ID from auth header or default
    const userId = (req as any).user?.id || 'system';

    const dashboard = await prisma.dashboard.create({
      data: {
        metabaseId: numericId,
        entityId: entityId || null,
        name,
        description: description || null,
        thumbnail: thumbnail || null,
        isDefault: isDefault || false,
        createdBy: userId,
      },
    });

    res.status(201).json({
      success: true,
      data: dashboard,
    });
  } catch (error) {
    console.error('Error creating dashboard:', error);
    res.status(500).json({
      success: false,
      error: { code: 'CREATE_ERROR', message: 'Failed to create dashboard' },
    });
  }
});

// PUT /dashboards/:id - Update dashboard (admin only)
router.put('/dashboards/:id', async (req: Request, res: Response) => {
  try {
    const { name, description, thumbnail, isDefault, order } = req.body;

    const dashboard = await prisma.dashboard.update({
      where: { id: req.params.id },
      data: {
        name,
        description,
        thumbnail,
        isDefault,
        order,
      },
    });

    res.json({
      success: true,
      data: dashboard,
    });
  } catch (error) {
    console.error('Error updating dashboard:', error);
    res.status(500).json({
      success: false,
      error: { code: 'UPDATE_ERROR', message: 'Failed to update dashboard' },
    });
  }
});

// DELETE /dashboards/:id - Delete dashboard (admin only)
router.delete('/dashboards/:id', async (req: Request, res: Response) => {
  try {
    await prisma.dashboard.delete({
      where: { id: req.params.id },
    });

    res.json({
      success: true,
      data: { deleted: true },
    });
  } catch (error) {
    console.error('Error deleting dashboard:', error);
    res.status(500).json({
      success: false,
      error: { code: 'DELETE_ERROR', message: 'Failed to delete dashboard' },
    });
  }
});

export { router as dashboardRoutes };
