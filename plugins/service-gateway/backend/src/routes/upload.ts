import { Router, type Request, type Response } from 'express';
import { UploadSchema, validateHost, validateRemotePath } from '../lib/validator.js';
import { SSHBridgeError } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import type { SSHConnectionPool } from '../lib/pool.js';
import type { Client } from 'ssh2';

const MAX_UPLOAD_BYTES = 50 * 1024 * 1024; // 50MB

export function createUploadRouter(pool: SSHConnectionPool): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || '';
    const actor = (req.headers['x-team-id'] as string) || 'unknown';
    const startMs = Date.now();

    let input;
    try {
      input = UploadSchema.parse(req.body);
    } catch (err) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: String(err) } });
      return;
    }

    try {
      validateHost(input.host);
      validateRemotePath(input.remotePath);
    } catch (err) {
      if (err instanceof SSHBridgeError) {
        res.status(err.statusCode).json(err.toJSON());
        return;
      }
      throw err;
    }

    const buffer = Buffer.from(input.content, 'base64');
    if (buffer.length > MAX_UPLOAD_BYTES) {
      res.status(413).json({ success: false, error: { code: 'PAYLOAD_TOO_LARGE', message: `File exceeds ${MAX_UPLOAD_BYTES} bytes` } });
      return;
    }

    const privateKey = req.headers['x-ssh-private-key'] as string | undefined;
    const passphrase = req.headers['x-ssh-passphrase'] as string | undefined;

    let client: Client | undefined;
    try {
      client = await pool.acquire(input.host, input.port, input.username, privateKey, passphrase);

      const bytesWritten = await sftpUpload(client, input.remotePath, buffer, parseInt(input.mode, 8));
      const durationMs = Date.now() - startMs;

      audit({
        requestId, actor, action: 'upload',
        targetHost: input.host, targetPort: input.port, username: input.username,
        command: `upload → ${input.remotePath}`, status: 'completed',
        durationMs, bytesTransferred: bytesWritten,
      });

      res.json({ success: true, data: { remotePath: input.remotePath, bytesWritten } });
    } catch (err) {
      audit({
        requestId, actor, action: 'upload',
        targetHost: input.host, targetPort: input.port, username: input.username,
        command: `upload → ${input.remotePath}`, status: 'failed',
        durationMs: Date.now() - startMs,
        error: err instanceof Error ? err.message : String(err),
      });
      if (err instanceof SSHBridgeError) {
        res.status(err.statusCode).json(err.toJSON());
        return;
      }
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Upload failed' } });
    } finally {
      if (client) pool.release(client);
    }
  });

  return router;
}

function sftpUpload(client: Client, remotePath: string, data: Buffer, mode: number): Promise<number> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) { reject(err); return; }
      const stream = sftp.createWriteStream(remotePath, { mode });
      stream.on('close', () => { sftp.end(); resolve(data.length); });
      stream.on('error', (e: Error) => { sftp.end(); reject(e); });
      stream.end(data);
    });
  });
}
