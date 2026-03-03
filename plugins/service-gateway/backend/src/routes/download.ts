import { Router, type Request, type Response } from 'express';
import { DownloadSchema, validateHost, validateRemotePath } from '../lib/validator.js';
import { SSHBridgeError } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import type { SSHConnectionPool } from '../lib/pool.js';
import type { Client } from 'ssh2';

const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024; // 50MB

export function createDownloadRouter(pool: SSHConnectionPool): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || '';
    const actor = (req.headers['x-team-id'] as string) || 'unknown';
    const startMs = Date.now();

    let input;
    try {
      input = DownloadSchema.parse(req.body);
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

    const privateKey = req.headers['x-ssh-private-key'] as string | undefined;
    const passphrase = req.headers['x-ssh-passphrase'] as string | undefined;

    let client: Client | undefined;
    try {
      client = await pool.acquire(input.host, input.port, input.username, privateKey, passphrase);

      const data = await sftpDownload(client, input.remotePath, MAX_DOWNLOAD_BYTES);
      const durationMs = Date.now() - startMs;

      audit({
        requestId, actor, action: 'download',
        targetHost: input.host, targetPort: input.port, username: input.username,
        command: `download ← ${input.remotePath}`, status: 'completed',
        durationMs, bytesTransferred: data.length,
      });

      res.json({
        success: true,
        data: { content: data.toString('base64'), size: data.length },
      });
    } catch (err) {
      audit({
        requestId, actor, action: 'download',
        targetHost: input.host, targetPort: input.port, username: input.username,
        command: `download ← ${input.remotePath}`, status: 'failed',
        durationMs: Date.now() - startMs,
        error: err instanceof Error ? err.message : String(err),
      });
      if (err instanceof SSHBridgeError) {
        res.status(err.statusCode).json(err.toJSON());
        return;
      }
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Download failed' } });
    } finally {
      if (client) pool.release(client);
    }
  });

  return router;
}

function sftpDownload(client: Client, remotePath: string, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) { reject(err); return; }
      const chunks: Buffer[] = [];
      let totalBytes = 0;
      const stream = sftp.createReadStream(remotePath);
      stream.on('data', (chunk: Buffer) => {
        totalBytes += chunk.length;
        if (totalBytes > maxBytes) {
          stream.destroy();
          sftp.end();
          reject(new Error(`File exceeds maximum download size of ${maxBytes} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('end', () => { sftp.end(); resolve(Buffer.concat(chunks)); });
      stream.on('error', (e: Error) => { sftp.end(); reject(e); });
    });
  });
}
