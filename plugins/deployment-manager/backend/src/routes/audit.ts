import { Router } from 'express';
import type { AuditService } from '../services/AuditService.js';

export function createAuditRouter(audit: AuditService): Router {
  const router = Router();

  router.get('/', async (req, res) => {
    try {
      const { deploymentId, userId, action, limit, offset } = req.query;
      const result = await audit.query({
        deploymentId: deploymentId as string | undefined,
        userId: userId as string | undefined,
        action: action as string | undefined,
        limit: limit ? parseInt(limit as string, 10) : 50,
        offset: offset ? parseInt(offset as string, 10) : 0,
      });
      res.json({ success: true, data: result.data, total: result.total });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}
