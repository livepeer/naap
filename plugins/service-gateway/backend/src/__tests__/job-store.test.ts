import { describe, it, expect, beforeEach } from 'vitest';
import { JobStore } from '../lib/job-store.js';

describe('JobStore', () => {
  let store: JobStore;

  beforeEach(() => {
    store = new JobStore();
  });

  it('creates a job with running status', () => {
    const job = store.createJob('10.0.1.5', 'deploy', 'echo hello');
    expect(job.jobId).toMatch(/^j_/);
    expect(job.status).toBe('running');
    expect(job.host).toBe('10.0.1.5');
  });

  it('retrieves a job by id', () => {
    const created = store.createJob('10.0.1.5', 'deploy', 'echo hello');
    const retrieved = store.getJob(created.jobId);
    expect(retrieved.jobId).toBe(created.jobId);
  });

  it('throws on unknown job id', () => {
    expect(() => store.getJob('j_nonexistent')).toThrow(/not found/);
  });

  it('appends stdout and truncates at limit', () => {
    const job = store.createJob('host', 'user', 'cmd');
    const chunk = 'x'.repeat(100_000);
    for (let i = 0; i < 15; i++) {
      store.appendStdout(job.jobId, chunk);
    }
    const retrieved = store.getJob(job.jobId);
    expect(retrieved.stdout.length).toBeLessThanOrEqual(1_048_576);
  });

  it('completes a job with exit code', () => {
    const job = store.createJob('host', 'user', 'cmd');
    store.completeJob(job.jobId, 0);
    const retrieved = store.getJob(job.jobId);
    expect(retrieved.status).toBe('completed');
    expect(retrieved.exitCode).toBe(0);
    expect(retrieved.completedAt).toBeDefined();
  });

  it('marks failed job correctly', () => {
    const job = store.createJob('host', 'user', 'cmd');
    store.completeJob(job.jobId, 1);
    expect(store.getJob(job.jobId).status).toBe('failed');
  });

  it('fails a job with error message', () => {
    const job = store.createJob('host', 'user', 'cmd');
    store.failJob(job.jobId, 'Connection lost');
    const retrieved = store.getJob(job.jobId);
    expect(retrieved.status).toBe('failed');
    expect(retrieved.stderr).toContain('Connection lost');
  });

  it('cancels a running job', () => {
    const job = store.createJob('host', 'user', 'cmd');
    store.cancelJob(job.jobId);
    expect(store.getJob(job.jobId).status).toBe('cancelled');
  });

  it('returns logs with offset', () => {
    const job = store.createJob('host', 'user', 'cmd');
    store.appendStdout(job.jobId, 'line1\nline2\nline3\n');
    const logs = store.getJobLogs(job.jobId, 6, 10);
    expect(logs.stdout).toBe('line2\nline');
    expect(logs.offset).toBe(6);
  });

  it('reports stats', () => {
    store.createJob('host', 'user', 'cmd1');
    const j2 = store.createJob('host', 'user', 'cmd2');
    store.completeJob(j2.jobId, 0);
    const stats = store.stats();
    expect(stats.total).toBe(2);
    expect(stats.running).toBe(1);
    expect(stats.completed).toBe(1);
  });
});
