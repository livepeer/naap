import { Router, type Request, type Response } from 'express';
import { ExecScriptSchema, validateHost, validateScript } from '../lib/validator.js';
import { SSHBridgeError, CommandTimeoutError } from '../lib/errors.js';
import { audit, logError } from '../lib/audit.js';
import type { SSHConnectionPool } from '../lib/pool.js';
import type { JobStore } from '../lib/job-store.js';
import type { Client } from 'ssh2';

export function createExecScriptRouter(pool: SSHConnectionPool, jobStore: JobStore): Router {
  const router = Router();

  router.post('/', async (req: Request, res: Response) => {
    const requestId = (req.headers['x-request-id'] as string) || '';
    const actor = (req.headers['x-team-id'] as string) || 'unknown';

    let input;
    try {
      input = ExecScriptSchema.parse(req.body);
    } catch (err) {
      res.status(400).json({ success: false, error: { code: 'VALIDATION_ERROR', message: String(err) } });
      return;
    }

    try {
      validateHost(input.host);
      validateScript(input.script);
    } catch (err) {
      if (err instanceof SSHBridgeError) {
        res.status(err.statusCode).json(err.toJSON());
        return;
      }
      throw err;
    }

    let job;
    try {
      job = jobStore.createJob(input.host, input.username, `[script: ${input.script.split('\n')[0]}...]`);
    } catch (err) {
      if (err instanceof SSHBridgeError) {
        res.status(err.statusCode).json(err.toJSON());
        return;
      }
      throw err;
    }

    const scriptPath = `/tmp/naap-${job.jobId}.sh`;

    audit({
      requestId, jobId: job.jobId, actor, action: 'exec.script',
      targetHost: input.host, targetPort: input.port, username: input.username,
      command: scriptPath, status: 'started',
    });

    res.json({
      success: true,
      data: { jobId: job.jobId, status: 'running', scriptPath },
    });

    const privateKey = req.headers['x-ssh-private-key'] as string | undefined;
    const passphrase = req.headers['x-ssh-passphrase'] as string | undefined;

    runScript(pool, jobStore, job.jobId, input, scriptPath, privateKey, passphrase, requestId, actor);
  });

  return router;
}

async function runScript(
  pool: SSHConnectionPool,
  jobStore: JobStore,
  jobId: string,
  input: { host: string; port: number; username: string; script: string; env: Record<string, string>; timeout: number; workingDirectory: string },
  scriptPath: string,
  privateKey: string | undefined,
  passphrase: string | undefined,
  requestId: string,
  actor: string,
): Promise<void> {
  let client: Client | undefined;
  try {
    client = await pool.acquire(input.host, input.port, input.username, privateKey, passphrase);

    await uploadScript(client, scriptPath, input.script);

    const envPrefix = Object.entries(input.env || {})
      .map(([k, v]) => `export ${k}='${v.replace(/'/g, "'\\''")}'`)
      .join('; ');
    const runCommand = `cd ${input.workingDirectory} 2>/dev/null; ${envPrefix ? envPrefix + '; ' : ''}bash -euo pipefail ${scriptPath}; EXIT_CODE=$?; rm -f ${scriptPath}; exit $EXIT_CODE`;

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        jobStore.timeoutJob(jobId);
        cleanupScript(client!, scriptPath);
        reject(new CommandTimeoutError(input.timeout));
      }, input.timeout);

      client!.exec(runCommand, (err, stream) => {
        if (err) {
          clearTimeout(timer);
          cleanupScript(client!, scriptPath);
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
      requestId, jobId, actor, action: 'exec.script',
      targetHost: input.host, targetPort: input.port, username: input.username,
      command: scriptPath, status: job.status,
      exitCode: job.exitCode, durationMs: job.durationMs,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    jobStore.failJob(jobId, message);
    logError(`Script job ${jobId} failed`, err);
    audit({
      requestId, jobId, actor, action: 'exec.script',
      targetHost: input.host, targetPort: input.port, username: input.username,
      command: scriptPath, status: 'failed', error: message,
    });
  } finally {
    if (client) pool.release(client);
  }
}

function uploadScript(client: Client, remotePath: string, content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.sftp((err, sftp) => {
      if (err) { reject(err); return; }
      const stream = sftp.createWriteStream(remotePath, { mode: 0o755 });
      stream.on('close', () => { sftp.end(); resolve(); });
      stream.on('error', (e: Error) => { sftp.end(); reject(e); });
      stream.end(content);
    });
  });
}

function cleanupScript(client: Client, remotePath: string): void {
  try {
    client.exec(`rm -f ${remotePath}`, () => {});
  } catch { /* best-effort */ }
}
