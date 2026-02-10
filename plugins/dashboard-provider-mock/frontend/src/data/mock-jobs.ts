import type { JobFeedEntry } from '@naap/plugin-sdk';

const PIPELINES = [
  'Text-to-Image',
  'Image-to-Video',
  'Video-to-Video',
  'Upscale',
  'Audio-to-Text',
  'LLM',
];

const STATUSES: JobFeedEntry['status'][] = ['running', 'completed', 'completed', 'completed', 'failed'];

/**
 * Generate a random mock job entry.
 * Used by the job feed emitter to simulate live job events.
 */
export function generateMockJob(): JobFeedEntry {
  const id = `job_${Math.random().toString(36).slice(2, 8)}`;
  const pipeline = PIPELINES[Math.floor(Math.random() * PIPELINES.length)];
  const status = STATUSES[Math.floor(Math.random() * STATUSES.length)];

  return {
    id,
    pipeline,
    status,
    startedAt: new Date().toISOString(),
    latencyMs: Math.floor(Math.random() * 500) + 50,
  };
}

/** Initial seed of mock jobs for first render */
export const mockInitialJobs: JobFeedEntry[] = [
  { id: 'job_8f2a1c', pipeline: 'Text-to-Image', status: 'running', startedAt: new Date(Date.now() - 10000).toISOString() },
  { id: 'job_7e3b9d', pipeline: 'Video-to-Video', status: 'completed', startedAt: new Date(Date.now() - 20000).toISOString() },
  { id: 'job_6d4c8e', pipeline: 'Image-to-Video', status: 'running', startedAt: new Date(Date.now() - 30000).toISOString() },
  { id: 'job_5c5d7f', pipeline: 'Upscale', status: 'completed', startedAt: new Date(Date.now() - 40000).toISOString() },
  { id: 'job_4b6e6g', pipeline: 'Text-to-Image', status: 'completed', startedAt: new Date(Date.now() - 50000).toISOString() },
  { id: 'job_3a7f5h', pipeline: 'Audio-to-Text', status: 'completed', startedAt: new Date(Date.now() - 60000).toISOString() },
  { id: 'job_2z8g4i', pipeline: 'Video-to-Video', status: 'completed', startedAt: new Date(Date.now() - 70000).toISOString() },
  { id: 'job_1y9h3j', pipeline: 'Image-to-Video', status: 'failed', startedAt: new Date(Date.now() - 80000).toISOString() },
];
