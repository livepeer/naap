import { v4 as uuidv4 } from 'uuid';
import { JobLimitExceededError, JobNotFoundError } from './errors.js';

export type JobStatus = 'pending' | 'running' | 'completed' | 'failed' | 'cancelled' | 'timeout';

export interface Job {
  jobId: string;
  status: JobStatus;
  host: string;
  username: string;
  command: string;
  startedAt: string;
  completedAt?: string;
  exitCode?: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  abortController?: AbortController;
}

const MAX_STDOUT_BYTES = 1_048_576; // 1MB
const MAX_STDERR_BYTES = 262_144;   // 256KB
const JOB_TTL_MS = 3_600_000;      // 1 hour
const MAX_CONCURRENT_JOBS = 100;

export class JobStore {
  private jobs = new Map<string, Job>();
  private cleanupInterval: ReturnType<typeof setInterval>;

  constructor() {
    this.cleanupInterval = setInterval(() => this.evictExpired(), 60_000);
  }

  createJob(host: string, username: string, command: string): Job {
    const running = this.countByStatus('running') + this.countByStatus('pending');
    if (running >= MAX_CONCURRENT_JOBS) {
      throw new JobLimitExceededError(MAX_CONCURRENT_JOBS);
    }

    const job: Job = {
      jobId: `j_${uuidv4().replace(/-/g, '').slice(0, 12)}`,
      status: 'running',
      host,
      username,
      command: command.length > 500 ? command.slice(0, 500) + '...' : command,
      startedAt: new Date().toISOString(),
      exitCode: undefined,
      stdout: '',
      stderr: '',
      durationMs: 0,
    };

    this.jobs.set(job.jobId, job);
    return job;
  }

  getJob(jobId: string): Job {
    const job = this.jobs.get(jobId);
    if (!job) throw new JobNotFoundError(jobId);
    if (job.status === 'running') {
      job.durationMs = Date.now() - new Date(job.startedAt).getTime();
    }
    return job;
  }

  appendStdout(jobId: string, data: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.stdout += data;
    if (job.stdout.length > MAX_STDOUT_BYTES) {
      job.stdout = job.stdout.slice(-MAX_STDOUT_BYTES);
    }
  }

  appendStderr(jobId: string, data: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.stderr += data;
    if (job.stderr.length > MAX_STDERR_BYTES) {
      job.stderr = job.stderr.slice(-MAX_STDERR_BYTES);
    }
  }

  completeJob(jobId: string, exitCode: number): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = exitCode === 0 ? 'completed' : 'failed';
    job.exitCode = exitCode;
    job.completedAt = new Date().toISOString();
    job.durationMs = Date.now() - new Date(job.startedAt).getTime();
  }

  failJob(jobId: string, error: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = 'failed';
    job.exitCode = -1;
    job.completedAt = new Date().toISOString();
    job.durationMs = Date.now() - new Date(job.startedAt).getTime();
    job.stderr += `\n[ssh-bridge] ${error}`;
  }

  timeoutJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) return;
    job.status = 'timeout';
    job.exitCode = -1;
    job.completedAt = new Date().toISOString();
    job.durationMs = Date.now() - new Date(job.startedAt).getTime();
    job.stderr += '\n[ssh-bridge] Command timed out';
  }

  cancelJob(jobId: string): void {
    const job = this.jobs.get(jobId);
    if (!job) throw new JobNotFoundError(jobId);
    if (job.status !== 'running' && job.status !== 'pending') {
      return;
    }
    job.status = 'cancelled';
    job.completedAt = new Date().toISOString();
    job.durationMs = Date.now() - new Date(job.startedAt).getTime();
    job.abortController?.abort();
  }

  getJobLogs(jobId: string, offset = 0, limit = 65536): { stdout: string; offset: number; totalBytes: number } {
    const job = this.getJob(jobId);
    const totalBytes = job.stdout.length;
    const stdout = job.stdout.slice(offset, offset + limit);
    return { stdout, offset, totalBytes };
  }

  private countByStatus(status: JobStatus): number {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (job.status === status) count++;
    }
    return count;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [id, job] of this.jobs.entries()) {
      if (job.status === 'running' || job.status === 'pending') continue;
      const completedAt = job.completedAt ? new Date(job.completedAt).getTime() : 0;
      if (now - completedAt > JOB_TTL_MS) {
        this.jobs.delete(id);
      }
    }
  }

  stats(): { total: number; running: number; completed: number } {
    return {
      total: this.jobs.size,
      running: this.countByStatus('running'),
      completed: this.countByStatus('completed') + this.countByStatus('failed'),
    };
  }

  shutdown(): void {
    clearInterval(this.cleanupInterval);
    for (const job of this.jobs.values()) {
      if (job.status === 'running') {
        job.abortController?.abort();
      }
    }
  }
}
