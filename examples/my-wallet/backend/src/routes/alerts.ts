/**
 * Alert management routes
 */

import { Router, Request, Response } from 'express';
import {
  listAlerts,
  createAlert,
  updateAlert,
  deleteAlert,
  getAlertHistory,
  markAlertRead,
  getUnreadCount,
} from '../lib/alertService.js';

const router = Router();

// List alerts for user
router.get('/api/v1/wallet/alerts', async (req: Request, res: Response) => {
  try {
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const [alerts, unreadCount] = await Promise.all([
      listAlerts(userId as string),
      getUnreadCount(userId as string),
    ]);
    res.json({ alerts, unreadCount });
  } catch (error: any) {
    console.error('Error fetching alerts:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Create alert
router.post('/api/v1/wallet/alerts', async (req: Request, res: Response) => {
  try {
    const { userId, type, orchestratorAddr, threshold, enabled } = req.body;
    if (!userId || !type) return res.status(400).json({ error: 'userId and type are required' });

    const validTypes = ['reward_cut_change', 'missed_reward', 'deactivation', 'unbonding_ready'];
    if (!validTypes.includes(type)) {
      return res.status(400).json({ error: `Invalid alert type. Must be one of: ${validTypes.join(', ')}` });
    }

    const alert = await createAlert(userId, { type, orchestratorAddr, threshold, enabled });
    res.status(201).json({ alert });
  } catch (error: any) {
    console.error('Error creating alert:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Update alert
router.patch('/api/v1/wallet/alerts/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { userId, ...updates } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const alert = await updateAlert(id, userId, updates);
    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    res.json({ alert });
  } catch (error: any) {
    console.error('Error updating alert:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Delete alert
router.delete('/api/v1/wallet/alerts/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { userId } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const alert = await deleteAlert(id, userId as string);
    if (!alert) return res.status(404).json({ error: 'Alert not found' });
    res.json({ deleted: true });
  } catch (error: any) {
    console.error('Error deleting alert:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Alert history
router.get('/api/v1/wallet/alerts/history', async (req: Request, res: Response) => {
  try {
    const { userId, limit = '50', offset = '0' } = req.query;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const result = await getAlertHistory(
      userId as string,
      parseInt(limit as string, 10),
      parseInt(offset as string, 10)
    );
    res.json(result);
  } catch (error: any) {
    console.error('Error fetching alert history:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

// Mark alert history as read
router.patch('/api/v1/wallet/alerts/history/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });

    const item = await markAlertRead(id, userId);
    if (!item) return res.status(404).json({ error: 'Alert history item not found' });
    res.json({ item });
  } catch (error: any) {
    console.error('Error marking alert read:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
});

export default router;
