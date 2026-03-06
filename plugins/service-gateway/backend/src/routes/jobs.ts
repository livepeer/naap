import { Router, type Request, type Response } from 'express';
import { SSHBridgeError } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import type { JobStore } from '../lib/job-store.js';

export function createJobsRouter(jobStore: JobStore): Router {
  const router = Router();

  router.get('/:jobId', (req: Request, res: Response) => {
    try {
      const job = jobStore.getJob(req.params.jobId);
      const data: Record<string, unknown> = {
        jobId: job.jobId,
        status: job.status,
        startedAt: job.startedAt,
        durationMs: job.durationMs,
      };

      if (job.status === 'running') {
        data.stdoutTail = job.stdout.slice(-2048);
      } else {
        data.completedAt = job.completedAt;
        data.exitCode = job.exitCode;
        data.stdout = job.stdout;
        data.stderr = job.stderr;
      }

      res.json({ success: true, data });
    } catch (err) {
      if (err instanceof SSHBridgeError) {
        res.status(err.statusCode).json(err.toJSON());
        return;
      }
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to get job' } });
    }
  });

  router.get('/:jobId/logs', (req: Request, res: Response) => {
    try {
      const offset = parseInt(req.query.offset as string, 10) || 0;
      const limit = parseInt(req.query.limit as string, 10) || 65536;
      const job = jobStore.getJob(req.params.jobId);
      const logs = jobStore.getJobLogs(req.params.jobId, offset, limit);

      res.json({
        success: true,
        data: {
          jobId: job.jobId,
          status: job.status,
          stdout: logs.stdout,
          offset: logs.offset,
          totalBytes: logs.totalBytes,
        },
      });
    } catch (err) {
      if (err instanceof SSHBridgeError) {
        res.status(err.statusCode).json(err.toJSON());
        return;
      }
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to get logs' } });
    }
  });

  router.delete('/:jobId', (req: Request, res: Response) => {
    const actor = (req.headers['x-team-id'] as string) || 'unknown';
    try {
      const job = jobStore.getJob(req.params.jobId);
      jobStore.cancelJob(req.params.jobId);

      audit({
        requestId: (req.headers['x-request-id'] as string) || '',
        jobId: job.jobId, actor, action: 'job.cancel',
        targetHost: job.host, targetPort: 22, username: job.username,
        status: 'cancelled',
      });

      res.json({ success: true, data: { jobId: job.jobId, status: 'cancelled' } });
    } catch (err) {
      if (err instanceof SSHBridgeError) {
        res.status(err.statusCode).json(err.toJSON());
        return;
      }
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Failed to cancel job' } });
    }
  });

  return router;
}
