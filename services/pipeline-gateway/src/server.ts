/**
 * Pipeline Gateway Service (Phase 5b/5c/5d/5f refactor)
 *
 * Separate deployable from livepeer-svc.
 * Handles AI pipelines, live video, BYOC -- can deploy daily.
 * If pipeline-gateway goes down, staking/orchestrators/deposits still work.
 *
 * Key design:
 * - Dynamic pipeline registry (polls go-livepeer /getNetworkCapabilities)
 * - Adapter pattern (one module per pipeline type)
 * - Versioned response envelope
 * - Feature flags per pipeline
 * - Background jobs: capability sync, async job cleanup, usage aggregation
 */

import { createPluginServer } from '@naap/plugin-server-sdk';
import { pluginRateLimit } from '@naap/cache';
import { LivepeerAIClient } from '@naap/livepeer-node-client';
import type { PipelineDescriptor, PipelineResponse } from '@naap/livepeer-pipeline';
import {
  BatchAIAdapter,
  LLMStreamAdapter,
  AsyncJobAdapter,
  LiveVideoAdapter,
  BYOCAdapter,
  type PipelineContext,
} from './adapters/index.js';

// ─── Config ──────────────────────────────────────────────────────────────────

const LIVEPEER_AI_URL = process.env.LIVEPEER_AI_URL || 'http://localhost:9935';
const DISCOVERY_INTERVAL = 60_000;        // 60 seconds
const JOB_CLEANUP_INTERVAL = 300_000;     // 5 minutes
const HEALTH_CHECK_INTERVAL = 120_000;    // 2 minutes
const USAGE_FLUSH_INTERVAL = 60_000;      // 1 minute

// ─── Feature Flags ───────────────────────────────────────────────────────────

interface FeatureFlags {
  [pipelineName: string]: {
    enabled: boolean;
    maxRequestsPerMinute?: number;
    allowedUsers?: string[]; // empty = all
  };
}

const featureFlags: FeatureFlags = {};
const FEATURE_FLAG_URL =
  process.env.FEATURE_FLAG_URL ||
  (process.env.BASE_SVC_URL ? `${process.env.BASE_SVC_URL}/api/v1/base/config/features` : undefined);

function isPipelineEnabled(name: string): boolean {
  const flag = featureFlags[name];
  if (!flag) return true; // pipelines enabled by default
  return flag.enabled;
}

async function refreshFeatureFlags(): Promise<void> {
  if (!FEATURE_FLAG_URL) return;
  try {
    const res = await fetch(FEATURE_FLAG_URL);
    if (!res.ok) return;
    const payload = await res.json();

    // Support both { data: [{ key, enabled }] } and { data: { [key]: { enabled } } }
    if (payload?.features && typeof payload.features === 'object') {
      Object.entries(payload.features).forEach(([key, value]) => {
        featureFlags[key.replace('pipeline:', '')] = {
          enabled: Boolean(value),
        };
      });
    } else if (Array.isArray(payload?.data)) {
      for (const flag of payload.data) {
        const key = flag.key || flag.name;
        if (typeof key === 'string') {
          featureFlags[key.replace('pipeline:', '')] = {
            enabled: Boolean(flag.enabled),
          };
        }
      }
    } else if (payload?.data && typeof payload.data === 'object') {
      Object.entries(payload.data).forEach(([key, value]) => {
        featureFlags[key.replace('pipeline:', '')] = {
          enabled: Boolean((value as any).enabled ?? value),
        };
      });
    }
  } catch (err) {
    console.warn('[pipeline-gateway] feature flag refresh failed:', err);
  }
}

// ─── AI Client + Adapters ────────────────────────────────────────────────────

const aiClient = new LivepeerAIClient(LIVEPEER_AI_URL);

const batchAdapter = new BatchAIAdapter(aiClient);
const llmAdapter = new LLMStreamAdapter(aiClient);
const asyncAdapter = new AsyncJobAdapter(aiClient);
const liveVideoAdapter = new LiveVideoAdapter(aiClient);
const byocAdapter = new BYOCAdapter();

// ─── Pipeline Registry (in-memory) ──────────────────────────────────────────

let discoveredPipelines: PipelineDescriptor[] = [];

async function discoverPipelines(): Promise<void> {
  try {
    const capabilities = await aiClient.getNetworkCapabilities();
    discoveredPipelines = capabilities.map((cap) => ({
      name: cap.name,
      type: 'batch' as const,
      models: [],
      capabilities: [cap.id],
      pricing: [],
      source: 'builtin' as const,
    }));

    // Merge in BYOC capabilities
    for (const byoc of byocAdapter.listCapabilities()) {
      if (!discoveredPipelines.some((p) => p.name === byoc.name)) {
        discoveredPipelines.push({
          name: byoc.name,
          type: 'batch',
          models: [],
          capabilities: [byoc.name],
          pricing: [],
          source: 'byoc' as const,
        });
      }
    }

    console.log(`[pipeline-gateway] Discovered ${discoveredPipelines.length} pipelines`);
  } catch (err) {
    console.warn('[pipeline-gateway] Pipeline discovery failed:', err);
  }
}

// ─── Usage Aggregation ───────────────────────────────────────────────────────

interface UsageBucket {
  pipeline: string;
  requests: number;
  errors: number;
  totalDurationMs: number;
  periodStart: number;
}

const usageBuckets = new Map<string, UsageBucket>();

function recordUsage(pipeline: string, durationMs: number, isError: boolean): void {
  let bucket = usageBuckets.get(pipeline);
  if (!bucket) {
    bucket = { pipeline, requests: 0, errors: 0, totalDurationMs: 0, periodStart: Date.now() };
    usageBuckets.set(pipeline, bucket);
  }
  bucket.requests++;
  bucket.totalDurationMs += durationMs;
  if (isError) bucket.errors++;
}

function flushUsage(): void {
  if (usageBuckets.size === 0) return;
  const buckets = Array.from(usageBuckets.values());
  console.log('[pipeline-gateway] Usage summary:', JSON.stringify(buckets));
  usageBuckets.clear();
}

// ─── Adapter Router ──────────────────────────────────────────────────────────

function selectAdapter(pipelineName: string) {
  // Priority: specific adapters first, then BYOC, then batch fallback
  const pipeline = discoveredPipelines.find((p) => p.name === pipelineName);
  if (!pipeline) return null;

  if (pipelineName === 'llm') return llmAdapter;
  if (pipelineName === 'live-video-to-video') return liveVideoAdapter;
  if (asyncAdapter.canHandle(pipeline)) return asyncAdapter;
  if (byocAdapter.canHandle(pipeline)) return byocAdapter;
  if (batchAdapter.canHandle(pipeline)) return batchAdapter;
  return batchAdapter; // default fallback
}

// ─── Server ──────────────────────────────────────────────────────────────────

const { router, start } = createPluginServer({
  name: 'pipeline-gateway',
  port: parseInt(process.env.PORT || '4020', 10),
  publicRoutes: ['/healthz', '/api/v1/pipelines'],
});

// ─── Routes ──────────────────────────────────────────────────────────────────

// Rate limit all pipeline endpoints per user/team
router.use('/pipelines', pluginRateLimit);

// List available pipelines
router.get('/pipelines', async (_req, res) => {
  const enabledPipelines = discoveredPipelines.filter((p) => isPipelineEnabled(p.name));
  res.json({
    success: true,
    data: enabledPipelines,
    meta: { discoveredAt: new Date().toISOString(), totalRegistered: discoveredPipelines.length },
  });
});

// Get pipeline schema
router.get('/pipelines/:pipeline/schema', async (req, res) => {
  const pipeline = discoveredPipelines.find((p) => p.name === req.params.pipeline);
  if (!pipeline) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: `Pipeline '${req.params.pipeline}' not found` },
    });
  }
  res.json({ success: true, data: { inputSchema: pipeline.inputSchema, outputSchema: pipeline.outputSchema } });
});

// Execute a pipeline (generic endpoint)
router.post('/pipelines/:pipeline', async (req, res) => {
  const pipelineName = req.params.pipeline;
  const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  const startTime = Date.now();

  // Feature flag check
  if (!isPipelineEnabled(pipelineName)) {
    return res.status(403).json({
      success: false,
      error: { code: 'PIPELINE_DISABLED', message: `Pipeline '${pipelineName}' is currently disabled` },
    });
  }

  const ctx: PipelineContext = { requestId, userId: (req as { userId?: string }).userId, startTime };

  try {
    const adapter = selectAdapter(pipelineName);
    if (!adapter) {
      return res.status(404).json({
        success: false,
        error: { code: 'PIPELINE_NOT_FOUND', message: `Pipeline '${pipelineName}' not available` },
      });
    }

    // Inject pipeline name for adapters that need it
    const input = { ...req.body, __pipeline: pipelineName };
    const { result, model, orchestrator } = await adapter.execute(input, ctx);

    const envelope: PipelineResponse = {
      version: '1.0',
      pipeline: pipelineName,
      model,
      status: 'success',
      requestId,
      result,
      metadata: {
        cost: '0',
        duration: Date.now() - startTime,
        orchestrator,
        cached: false,
      },
    };

    recordUsage(pipelineName, Date.now() - startTime, false);
    res.json(envelope);
  } catch (err) {
    const duration = Date.now() - startTime;
    recordUsage(pipelineName, duration, true);

    const envelope: PipelineResponse = {
      version: '1.0',
      pipeline: pipelineName,
      model: req.body?.model_id || 'default',
      status: 'error',
      requestId,
      result: null,
      metadata: { cost: '0', duration, orchestrator: 'unknown', cached: false },
      error: { code: 'PIPELINE_ERROR', message: err instanceof Error ? err.message : String(err) },
    };

    res.status(500).json(envelope);
  }
});

// LLM streaming endpoint
router.post('/pipelines/llm/stream', async (req, res) => {
  if (!isPipelineEnabled('llm')) {
    return res.status(403).json({ success: false, error: { code: 'PIPELINE_DISABLED' } });
  }

  const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  const ctx: PipelineContext = { requestId, startTime: Date.now() };

  await llmAdapter.executeStream(req.body, res, ctx);
  recordUsage('llm', Date.now() - ctx.startTime, false);
});

// Async job status polling
router.get('/pipelines/:pipeline/jobs/:requestId', async (req, res) => {
  const job = asyncAdapter.getJobStatus(req.params.requestId);
  if (!job) {
    return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Job not found' } });
  }
  res.json({ success: true, data: job });
});

// Live video-to-video session management
router.post('/pipelines/live-video-to-video/sessions', async (req, res) => {
  if (!isPipelineEnabled('live-video-to-video')) {
    return res.status(403).json({ success: false, error: { code: 'PIPELINE_DISABLED' } });
  }

  const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  const ctx: PipelineContext = { requestId, startTime: Date.now() };

  try {
    const { result, model, orchestrator } = await liveVideoAdapter.execute(req.body, ctx);
    res.json({
      version: '1.0',
      pipeline: 'live-video-to-video',
      model,
      status: 'success',
      requestId,
      result,
      metadata: { cost: '0', duration: Date.now() - ctx.startTime, orchestrator, cached: false },
    });
  } catch (err) {
    res.status(500).json({
      success: false,
      error: { code: 'SESSION_START_FAILED', message: String(err) },
    });
  }
});

// Get live session status
router.get('/pipelines/live-video-to-video/sessions/:stream', async (req, res) => {
  try {
    const status = await liveVideoAdapter.getSessionStatus(req.params.stream);
    if (!status) {
      return res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Session not found' } });
    }
    res.json({ success: true, data: status });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'STATUS_FAILED', message: String(err) } });
  }
});

// Stop live session
router.delete('/pipelines/live-video-to-video/sessions/:stream', async (req, res) => {
  try {
    liveVideoAdapter.stopSession(req.params.stream);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'STOP_FAILED', message: String(err) } });
  }
});

// Update live session params (trickle control)
router.patch('/pipelines/live-video-to-video/sessions/:stream', async (req, res) => {
  try {
    await liveVideoAdapter.updateSession(req.params.stream, req.body);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'UPDATE_FAILED', message: String(err) } });
  }
});

// ─── BYOC Registration Routes (Phase 5d) ────────────────────────────────────

router.post('/byoc/register', async (req, res) => {
  const { name, endpoint, registeredBy, schema, pricing, healthCheckUrl } = req.body;
  if (!name || !endpoint || !registeredBy) {
    return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'name, endpoint, registeredBy required' } });
  }

  byocAdapter.register(name, { endpoint, registeredBy, schema, pricing, healthCheckUrl });

  // Trigger immediate re-discovery to include the new capability
  await discoverPipelines();

  res.json({ success: true, data: { name, endpoint, registeredBy } });
});

router.delete('/byoc/register/:name', async (req, res) => {
  const registeredBy = req.body?.registeredBy || req.query.registeredBy;
  const success = byocAdapter.unregister(req.params.name, registeredBy as string);
  res.json({ success });
});

router.get('/byoc/capabilities', async (_req, res) => {
  res.json({ success: true, data: byocAdapter.listCapabilities() });
});

// Plan-compatible BYOC routes (aliases)
router.post('/pipelines/byoc/capabilities', async (req, res) => {
  const { name, endpoint, registeredBy, schema, pricing, healthCheckUrl } = req.body;
  if (!name || !endpoint || !registeredBy) {
    return res.status(400).json({ success: false, error: { code: 'BAD_REQUEST', message: 'name, endpoint, registeredBy required' } });
  }
  byocAdapter.register(name, { endpoint, registeredBy, schema, pricing, healthCheckUrl });
  await discoverPipelines();
  res.json({ success: true, data: { name, endpoint, registeredBy } });
});

router.delete('/pipelines/byoc/capabilities/:name', async (req, res) => {
  const registeredBy = req.body?.registeredBy || req.query.registeredBy;
  const success = byocAdapter.unregister(req.params.name, registeredBy as string);
  res.json({ success });
});

router.get('/pipelines/byoc/capabilities', async (_req, res) => {
  res.json({ success: true, data: byocAdapter.listCapabilities() });
});

router.post('/pipelines/byoc/:capability', async (req, res) => {
  const pipelineName = req.params.capability;
  const requestId = (req.headers['x-request-id'] as string) || crypto.randomUUID();
  const ctx: PipelineContext = { requestId, startTime: Date.now() };

  try {
    const { result, model, orchestrator } = await byocAdapter.execute({ ...req.body, __pipeline: pipelineName }, ctx);
    res.json({
      version: '1.0',
      pipeline: pipelineName,
      model,
      status: 'success',
      requestId,
      result,
      metadata: { cost: '0', duration: Date.now() - ctx.startTime, orchestrator, cached: false },
    });
  } catch (err) {
    res.status(500).json({ success: false, error: { code: 'BYOC_FAILED', message: String(err) } });
  }
});

// ─── Feature Flags Routes ────────────────────────────────────────────────────

router.get('/flags', async (_req, res) => {
  res.json({ success: true, data: featureFlags });
});

router.put('/flags/:pipeline', async (req, res) => {
  const pipeline = req.params.pipeline;
  if (['__proto__', 'constructor', 'prototype'].includes(pipeline)) {
    return res.status(400).json({ success: false, error: { code: 'INVALID_KEY', message: 'Invalid pipeline name' } });
  }
  featureFlags[pipeline] = {
    enabled: req.body.enabled ?? true,
    maxRequestsPerMinute: req.body.maxRequestsPerMinute,
    allowedUsers: req.body.allowedUsers,
  };
  res.json({ success: true, data: featureFlags[pipeline] });
});

// ─── Usage Stats Route ───────────────────────────────────────────────────────

router.get('/usage', async (_req, res) => {
  const buckets = Array.from(usageBuckets.values());
  res.json({ success: true, data: buckets });
});

// Metrics (simple JSON payload)
router.get('/metrics', async (_req, res) => {
  const buckets = Array.from(usageBuckets.values());
  const totalRequests = buckets.reduce((sum, b) => sum + b.requests, 0);
  const totalErrors = buckets.reduce((sum, b) => sum + b.errors, 0);
  const avgLatencyMs = totalRequests
    ? Math.round(buckets.reduce((sum, b) => sum + b.totalDurationMs, 0) / totalRequests)
    : 0;

  res.json({
    success: true,
    data: {
      totalRequests,
      totalErrors,
      avgLatencyMs,
      buckets,
      lastUpdated: new Date().toISOString(),
    },
  });
});

// ─── Start + Background Jobs (Phase 5f) ─────────────────────────────────────

start()
  .then(() => {
    // Initial discovery
    discoverPipelines();

    // Background job: periodic pipeline re-discovery (capability sync)
    setInterval(discoverPipelines, DISCOVERY_INTERVAL);

    // Background job: feature flag refresh
    refreshFeatureFlags();
    setInterval(refreshFeatureFlags, 60_000);

    // Background job: async job cleanup
    setInterval(() => {
      const cleaned = asyncAdapter.cleanupOldJobs();
      if (cleaned > 0) console.log(`[pipeline-gateway] Cleaned ${cleaned} old async jobs`);
    }, JOB_CLEANUP_INTERVAL);

    // Background job: BYOC health checking
    setInterval(async () => {
      await byocAdapter.healthCheckAll();
      const unhealthy = byocAdapter.getUnhealthy();
      if (unhealthy.length > 0) {
        console.warn(`[pipeline-gateway] ${unhealthy.length} BYOC capabilities unhealthy:`, unhealthy.map((c) => c.name));
      }
    }, HEALTH_CHECK_INTERVAL);

    // Background job: usage aggregation flush
    setInterval(flushUsage, USAGE_FLUSH_INTERVAL);

    // Background job: stale live session cleanup
    setInterval(() => {
      const cleaned = liveVideoAdapter.cleanupStaleSessions();
      if (cleaned > 0) console.log(`[pipeline-gateway] Cleaned ${cleaned} stale live sessions`);
    }, JOB_CLEANUP_INTERVAL);

    console.log('[pipeline-gateway] All background jobs started');
  })
  .catch((err) => {
    console.error('Failed to start pipeline-gateway:', err);
    process.exit(1);
  });
