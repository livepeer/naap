/**
 * Async Job Adapter (Phase 5b)
 *
 * Handles long-running pipelines like image-to-video.
 * Returns a requestId immediately, provides polling for results.
 * Pushes result via WebSocket when done (optional).
 */

import type { LivepeerAIClient } from '@naap/livepeer-node-client';
import type { IPipelineAdapter, PipelineDescriptor } from '@naap/livepeer-pipeline';
import type { PipelineContext, PipelineResult } from './BatchAIAdapter.js';

interface AsyncJob {
  requestId: string;
  pipeline: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  result?: unknown;
  error?: string;
  submittedAt: number;
  completedAt?: number;
}

const ASYNC_PIPELINES = new Set(['image-to-video']);

export class AsyncJobAdapter implements IPipelineAdapter {
  readonly name = 'async-job';
  readonly type = 'batch' as const;

  private jobs = new Map<string, AsyncJob>();

  constructor(private aiClient: LivepeerAIClient) {}

  canHandle(pipeline: PipelineDescriptor): boolean {
    return ASYNC_PIPELINES.has(pipeline.name);
  }

  /** Submit an async job -- returns immediately with requestId */
  async execute(input: unknown, ctx: PipelineContext): Promise<PipelineResult> {
    const body = input as Record<string, unknown>;
    const pipelineName = (body.__pipeline as string) || 'image-to-video';
    delete body.__pipeline;

    const job: AsyncJob = {
      requestId: ctx.requestId,
      pipeline: pipelineName,
      status: 'pending',
      submittedAt: ctx.startTime,
    };

    this.jobs.set(ctx.requestId, job);

    // Start processing in the background
    this.processJob(job, body).catch((err) => {
      job.status = 'error';
      job.error = err instanceof Error ? err.message : String(err);
      job.completedAt = Date.now();
    });

    return {
      result: {
        requestId: ctx.requestId,
        status: 'pending',
        message: 'Job submitted. Poll GET /pipelines/:pipeline/jobs/:requestId for status.',
      },
      model: (body.model_id as string) || 'default',
      orchestrator: 'auto',
    };
  }

  /** Get the status of an async job */
  getJobStatus(requestId: string): AsyncJob | null {
    return this.jobs.get(requestId) || null;
  }

  /** List all jobs (optional: filter by status) */
  listJobs(status?: AsyncJob['status']): AsyncJob[] {
    const all = Array.from(this.jobs.values());
    return status ? all.filter((j) => j.status === status) : all;
  }

  /** Clean up old completed/error jobs (called by background job) */
  cleanupOldJobs(maxAgeMs: number = 3600_000): number {
    const now = Date.now();
    let cleaned = 0;
    for (const [id, job] of this.jobs) {
      if (job.completedAt && now - job.completedAt > maxAgeMs) {
        this.jobs.delete(id);
        cleaned++;
      }
    }
    return cleaned;
  }

  private async processJob(job: AsyncJob, body: Record<string, unknown>): Promise<void> {
    job.status = 'processing';

    try {
      let result: unknown;
      switch (job.pipeline) {
        case 'image-to-video':
          result = await this.aiClient.imageToVideo(
            body.image as File,
            body as Parameters<LivepeerAIClient['imageToVideo']>[1]
          );
          break;
        default:
          result = await this.aiClient.processRequest(job.pipeline, body);
      }

      job.status = 'completed';
      job.result = result;
      job.completedAt = Date.now();
    } catch (err) {
      job.status = 'error';
      job.error = err instanceof Error ? err.message : String(err);
      job.completedAt = Date.now();
    }
  }
}
