import { Router, type Request, type Response } from 'express';
import { ConnectSchema, validateHost } from '../lib/validator.js';
import { SSHBridgeError } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import type { SSHConnectionPool } from '../lib/pool.js';
import type { Client } from 'ssh2';

export function createConnectRouter(pool: SSHConnectionPool): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || '';
    const actor = (req.headers['x-team-id'] as string) || 'unknown';
    const startMs = Date.now();

    let input;
    try {
      input = ConnectSchema.parse(req.body);
    } catch (err) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: String(err) } });
      return;
    }

    try {
      validateHost(input.host);
    } catch (err) {
      if (err instanceof SSHBridgeError) {
        res.status(err.statusCode).json(err.toJSON());
        return;
      }
      throw err;
    }

    const privateKey = req.headers['x-ssh-private-key'] as string | undefined;
    const passphrase = req.headers['x-ssh-passphrase'] as string | undefined;

    let client: Client | undefined;
    try {
      client = await pool.acquire(input.host, input.port, input.username, privateKey, passphrase);
      const latencyMs = Date.now() - startMs;

      audit({
        requestId, actor, action: 'connect',
        targetHost: input.host, targetPort: input.port, username: input.username,
        status: 'completed', durationMs: latencyMs,
      });

      res.json({
        success: true,
        data: { latencyMs, connected: true },
      });
    } catch (err) {
      audit({
        requestId, actor, action: 'connect',
        targetHost: input.host, targetPort: input.port, username: input.username,
        status: 'failed', durationMs: Date.now() - startMs,
        error: err instanceof Error ? err.message : String(err),
      });
      if (err instanceof SSHBridgeError) {
        res.status(err.statusCode).json(err.toJSON());
        return;
      }
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Connection test failed' } });
    } finally {
      if (client) pool.release(client);
    }
  });

  return router;
}
