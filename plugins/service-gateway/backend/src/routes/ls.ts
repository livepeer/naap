import { Router, type Request, type Response } from 'express';
import { LsSchema, validateHost, validateRemotePath } from '../lib/validator.js';
import { SSHBridgeError } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import type { SSHConnectionPool } from '../lib/pool.js';
import type { Client, SFTPWrapper } from 'ssh2';

interface DirEntry {
  name: string;
  type: 'file' | 'directory' | 'symlink' | 'other';
  size: number;
  modifiedAt: string;
}

export function createLsRouter(pool: SSHConnectionPool): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || '';
    const actor = (req.headers['x-team-id'] as string) || 'unknown';
    const startMs = Date.now();

    let input;
    try {
      input = LsSchema.parse(req.body);
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
      const entries = await sftpReaddir(client, input.remotePath);

      audit({
        requestId, actor, action: 'ls',
        targetHost: input.host, targetPort: input.port, username: input.username,
        command: `ls ${input.remotePath}`, status: 'completed',
        durationMs: Date.now() - startMs,
      });

      res.json({ success: true, data: { entries } });
    } catch (err) {
      audit({
        requestId, actor, action: 'ls',
        targetHost: input.host, targetPort: input.port, username: input.username,
        command: `ls ${input.remotePath}`, status: 'failed',
        durationMs: Date.now() - startMs,
        error: err instanceof Error ? err.message : String(err),
      });
      if (err instanceof SSHBridgeError) {
        res.status(err.statusCode).json(err.toJSON());
        return;
      }
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Directory listing failed' } });
    } finally {
      if (client) pool.release(client);
    }
  });

  return router;
}

function sftpReaddir(client: Client, remotePath: string): Promise<DirEntry[]> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp: SFTPWrapper) => {
      if (err) { reject(err); return; }
      sftp.readdir(remotePath, (readErr, list) => {
        sftp.end();
        if (readErr) { reject(readErr); return; }
        const entries: DirEntry[] = list.map((item) => {
          let type: DirEntry['type'] = 'other';
          if (item.attrs.isDirectory()) type = 'directory';
          else if (item.attrs.isFile()) type = 'file';
          else if (item.attrs.isSymbolicLink()) type = 'symlink';

          return {
            name: item.filename,
            type,
            size: item.attrs.size,
            modifiedAt: new Date(item.attrs.mtime * 1000).toISOString(),
          };
        });
        resolve(entries);
      });
    });
  });
}
