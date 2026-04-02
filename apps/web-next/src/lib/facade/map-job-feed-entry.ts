/**
 * Normalize NAAP / BFF job-feed rows to {@link JobFeedEntry} for the dashboard UI.
 *
 * Upstream JSON may use snake_case, alternate keys (`pipeline_slug`, `status` vs `state`),
 * or omit optional fields — the UI expects camelCase `status`, `startedAt`, `lastSeen`, etc.
 */

import type { JobFeedEntry } from '@naap/plugin-sdk';

function str(v: unknown): string | undefined {
  if (typeof v === 'string') {
    const t = v.trim();
    return t.length > 0 ? t : undefined;
  }
  return undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim()) {
    const n = Number(v);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function parseIsoMs(value: string | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function normalizeJobStatus(rawState: string | undefined): string {
  const state = rawState?.trim().toLowerCase() ?? '';
  return state || 'unknown';
}

function deriveDurationSeconds(o: {
  durationSeconds?: number;
  firstSeen?: string;
  lastSeen?: string;
}): number | undefined {
  const ds = num(o.durationSeconds);
  if (ds != null && Number.isFinite(ds) && ds >= 0) return ds;
  const firstMs = parseIsoMs(o.firstSeen);
  const lastMs = parseIsoMs(o.lastSeen);
  if (firstMs == null || lastMs == null) return undefined;
  return Math.max(0, Math.floor((lastMs - firstMs) / 1000));
}

/**
 * Coerce a single API / JSON row to {@link JobFeedEntry}, or `null` if it has no usable id + pipeline.
 */
export function mapApiRowToJobFeedEntry(raw: unknown): JobFeedEntry | null {
  if (raw == null || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;

  const id = str(o.id ?? o.stream_id ?? o.streamId ?? o.job_id ?? o.jobId);
  const pipeline = str(
    o.pipeline ?? o.pipeline_slug ?? o.pipeline_id ?? o.pipelineSlug ?? o.Pipeline ?? o.pipelineId,
  );
  if (!id || !pipeline) return null;

  const model = str(o.model ?? o.model_id ?? o.modelId ?? o.Model);
  const gateway = str(o.gateway ?? o.gateway_url ?? o.gatewayHost ?? o.Gateway) ?? '';
  const orchestratorUrl =
    str(o.orchestratorUrl ?? o.orchestrator_url ?? o.orchestratorURL ?? o.orchestrator) ?? '';

  const stateRaw = str(o.state ?? o.status ?? o.State ?? o.stream_state);
  const status = normalizeJobStatus(stateRaw);

  const firstSeen =
    str(o.firstSeen ?? o.first_seen ?? o.startedAt ?? o.started_at ?? o.created_at ?? o.CreatedAt) ?? '';
  const lastSeen = str(o.lastSeen ?? o.last_seen ?? o.updated_at ?? o.UpdatedAt) ?? '';

  const inputFps = num(o.inputFps ?? o.input_fps ?? o.InputFps) ?? 0;
  const outputFps = num(o.outputFps ?? o.output_fps ?? o.OutputFps) ?? 0;

  const durationSeconds = deriveDurationSeconds({
    durationSeconds: num(o.durationSeconds ?? o.duration_seconds),
    firstSeen,
    lastSeen,
  });
  const runningFor =
    str(o.runningFor ?? o.running_for) ?? (durationSeconds != null ? formatDuration(durationSeconds) : undefined);

  return {
    id,
    pipeline,
    model,
    status,
    startedAt: firstSeen,
    gateway,
    orchestratorUrl,
    inputFps,
    outputFps,
    lastSeen,
    durationSeconds,
    runningFor,
  };
}
