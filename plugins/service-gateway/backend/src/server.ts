import express from 'express';
import { SSHConnectionPool } from './lib/pool.js';
import { JobStore } from './lib/job-store.js';
import { logInfo, logError } from './lib/audit.js';
import { createExecRouter } from './routes/exec.js';
import { createExecAsyncRouter } from './routes/exec-async.js';
import { createExecScriptRouter } from './routes/exec-script.js';
import { createJobsRouter } from './routes/jobs.js';
import { createUploadRouter } from './routes/upload.js';
import { createDownloadRouter } from './routes/download.js';
import { createLsRouter } from './routes/ls.js';
import { createConnectRouter } from './routes/connect.js';

const PORT = parseInt(process.env.PORT || '4116', 10);
const pool = new SSHConnectionPool();
const jobStore = new JobStore();

const app = express();
app.use(express.json({ limit: '100mb' }));

app.get('/healthz', (_req, res) => {
  const poolStats = pool.stats();
  const jobStats = jobStore.stats();
  res.json({
    status: 'ok',
    service: 'ssh-bridge',
    uptime: process.uptime(),
    pool: poolStats,
    jobs: jobStats,
  });
});

app.use('/exec/async', createExecAsyncRouter(pool, jobStore));
app.use('/exec/script', createExecScriptRouter(pool, jobStore));
app.use('/exec', createExecRouter(pool));
app.use('/jobs', createJobsRouter(jobStore));
app.use('/upload', createUploadRouter(pool));
app.use('/download', createDownloadRouter(pool));
app.use('/ls', createLsRouter(pool));
app.use('/connect', createConnectRouter(pool));

const server = app.listen(PORT, () => {
  logInfo('SSH Bridge started', { port: PORT, pid: process.pid });
});

async function shutdown(signal: string) {
  logInfo(`Received ${signal}, shutting down...`);
  server.close();
  jobStore.shutdown();
  await pool.drain();
  logInfo('SSH Bridge stopped');
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logError('Unhandled rejection', reason);
});
