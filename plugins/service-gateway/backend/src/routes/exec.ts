import { Router, type Request, type Response } from 'express';
import { ExecSchema, validateHost, validateCommand } from '../lib/validator.js';
import { SSHBridgeError, CommandTimeoutError } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import type { SSHConnectionPool } from '../lib/pool.js';
import type { Client } from 'ssh2';

export function createExecRouter(pool: SSHConnectionPool): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || '';
    const actor = (req.headers['x-team-id'] as string) || 'unknown';
    const startMs = Date.now();

    let input;
    try {
      input = ExecSchema.parse(req.body);
    } catch (err) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: String(err) } });
      return;
    }

    try {
      validateHost(input.host);
      validateCommand(input.command);
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

      const { stdout, stderr, exitCode } = await execCommand(
        client,
        input.command,
        input.env || {},
        input.timeout,
      );

      const durationMs = Date.now() - startMs;
      audit({
        requestId, actor, action: 'exec',
        targetHost: input.host, targetPort: input.port, username: input.username,
        command: input.command, status: exitCode === 0 ? 'completed' : 'failed',
        exitCode, durationMs,
      });

      res.json({ success: true, data: { stdout, stderr, exitCode, durationMs } });
    } catch (err) {
      const durationMs = Date.now() - startMs;
      audit({
        requestId, actor, action: 'exec',
        targetHost: input.host, targetPort: input.port, username: input.username,
        command: input.command, status: 'failed', durationMs,
        error: err instanceof Error ? err.message : String(err),
      });

      if (err instanceof SSHBridgeError) {
        res.status(err.statusCode).json(err.toJSON());
        return;
      }
      res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Command execution failed' } });
    } finally {
      if (client) pool.release(client);
    }
  });

  return router;
}

export function execCommand(
  client: Client,
  command: string,
  env: Record<string, string>,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new CommandTimeoutError(timeoutMs));
    }, timeoutMs);

    const envPrefix = Object.entries(env)
      .map(([k, v]) => `export ${k}=${shellEscape(v)}`)
      .join('; ');
    const fullCommand = envPrefix ? `${envPrefix}; ${command}` : command;

    client.exec(fullCommand, (err, stream) => {
      if (err) {
        clearTimeout(timer);
        reject(err);
        return;
      }

      let stdout = '';
      let stderr = '';

      stream.on('data', (data: Buffer) => { stdout += data.toString(); });
      stream.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

      stream.on('close', (code: number) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, exitCode: code ?? -1 });
      });
    });
  });
}

function shellEscape(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
