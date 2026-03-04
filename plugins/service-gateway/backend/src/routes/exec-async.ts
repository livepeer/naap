import { Router, type Request, type Response } from 'express';
import { ExecAsyncSchema, validateHost, validateCommand } from '../lib/validator.js';
import { SSHBridgeError, CommandTimeoutError } from '../lib/errors.js';
import { audit, logError } from '../lib/audit.js';
import type { SSHConnectionPool } from '../lib/pool.js';
import type { JobStore } from '../lib/job-store.js';
import type { Client } from 'ssh2';

export function createExecAsyncRouter(pool: SSHConnectionPool, jobStore: JobStore): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || '';
    const actor = (req.headers['x-team-id'] as string) || 'unknown';

    let input;
    try {
      input = ExecAsyncSchema.parse(req.body);
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

    let job;
    try {
      job = jobStore.createJob(input.host, input.username, input.command);
    } catch (err) {
      if (err instanceof SSHBridgeError) {
        res.status(err.statusCode).json(err.toJSON());
        return;
      }
      throw err;
    }

    audit({
      requestId, jobId: job.jobId, actor, action: 'exec.async',
      targetHost: input.host, targetPort: input.port, username: input.username,
      command: input.command, status: 'started',
    });

    res.json({ success: true, data: { jobId: job.jobId, status: 'running' } });

    const privateKey = req.headers['x-ssh-private-key'] as string | undefined;
    const passphrase = req.headers['x-ssh-passphrase'] as string | undefined;

    runAsync(pool, jobStore, job.jobId, input, privateKey, passphrase, requestId, actor);
  });

  return router;
}

async function runAsync(
  pool: SSHConnectionPool,
  jobStore: JobStore,
  jobId: string,
  input: { host: string; port: number; username: string; command: string; env: Record<string, string>; timeout: number },
  privateKey: string | undefined,
  passphrase: string | undefined,
  requestId: string,
  actor: string,
): Promise<void> {
  let client: Client | undefined;
  try {
    client = await pool.acquire(input.host, input.port, input.username, privateKey, passphrase);

    const envPrefix = Object.entries(input.env || {})
      .map(([k, v]) => `export ${k}='${v.replace(/'/g, "'\\''")}'`)
      .join('; ');
    const fullCommand = envPrefix ? `${envPrefix}; ${input.command}` : input.command;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        jobStore.timeoutJob(jobId);
        reject(new CommandTimeoutError(input.timeout));
      }, input.timeout);

      client!.exec(fullCommand, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          reject(err);
          return;
        }

        stream.on('data', (data: Buffer) => {
          jobStore.appendStdout(jobId, data.toString());
        });
        stream.stderr.on('data', (data: Buffer) => {
          jobStore.appendStderr(jobId, data.toString());
        });
        stream.on('close', (code: number) => {
          clearTimeout(timer);
          jobStore.completeJob(jobId, code ?? -1);
          resolve();
        });
      });
    });

    const job = jobStore.getJob(jobId);
    audit({
      requestId, jobId, actor, action: 'exec.async',
      targetHost: input.host, targetPort: input.port, username: input.username,
      command: input.command, status: job.status,
      exitCode: job.exitCode, durationMs: job.durationMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    jobStore.failJob(jobId, message);
    logError(`Async job ${jobId} failed`, err);
    audit({
      requestId, jobId, actor, action: 'exec.async',
      targetHost: input.host, targetPort: input.port, username: input.username,
      command: input.command, status: 'failed', error: message,
    });
  } finally {
    if (client) pool.release(client);
  }
}
