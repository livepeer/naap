/**
 * PymtHouse Builder app network capability manifest (pipeline + modelId).
 *
 * A process-wide snapshot is refreshed on the same cadence as leaderboard data
 * (`refreshGlobalDataset`, plans cron, and dataset cron skip still refreshes manifest).
 * Request handlers read the snapshot synchronously (no per-request HTTP to PymtHouse).
 */

import { createHash } from 'node:crypto';

const TRAILING_SLASH = /\/+$/;

export interface PymthouseManifestCapability {
  pipeline: string;
  modelId: string;
}

export interface PymthouseManifestResponse {
  /** Resolved discoverable `(pipeline, modelId)` pairs (catalog minus Network Price exclusions). */
  capabilities: PymthouseManifestCapability[];
  /** Raw exclusions from the Network Price plan (same contract as Builder `PUT /manifest`). */
  excludedCapabilities?: PymthouseManifestCapability[];
  /** Server-computed revision; used for cache busting when present. */
  manifestVersion?: string;
}

interface GlobalManifestSnapshot {
  data: PymthouseManifestResponse | null;
  revision: string;
  updatedAt: number;
}

let globalSnapshot: GlobalManifestSnapshot = {
  data: null,
  revision: 'none',
  updatedAt: 0,
};

/** Legacy 45s cache — superseded by snapshot; kept for tests resetting the same shape. */
let cache: { at: number; data: PymthouseManifestResponse | null; ttlMs: number } = {
  at: 0,
  data: null,
  ttlMs: 45_000,
};

export function resetPymthouseManifestCacheForTests(): void {
  cache = { at: 0, data: null, ttlMs: 45_000 };
  globalSnapshot = { data: null, revision: 'none', updatedAt: 0 };
}

/** Test helper: inject snapshot without HTTP. */
export function seedPymthouseManifestForTests(
  data: PymthouseManifestResponse | null,
): void {
  globalSnapshot = {
    data,
    revision: computeManifestRevision(data),
    updatedAt: Date.now(),
  };
  cache = { at: Date.now(), data, ttlMs: cache.ttlMs };
}

export function getPymthouseApiV1Base(): string | null {
  const raw = process.env.PYMTHOUSE_ISSUER_URL?.trim();
  if (!raw) return null;
  const noTrail = raw.replace(TRAILING_SLASH, '');
  return noTrail.replace(/\/oidc\/?$/i, '');
}

function sortedCaps(caps: PymthouseManifestCapability[]): PymthouseManifestCapability[] {
  return [...caps].sort((a, b) => {
    const p = a.pipeline.localeCompare(b.pipeline);
    return p !== 0 ? p : a.modelId.localeCompare(b.modelId);
  });
}

export function computeManifestRevision(
  data: Pick<PymthouseManifestResponse, 'capabilities' | 'excludedCapabilities'> | null,
): string {
  if (data == null) {
    return 'unavailable';
  }
  const caps = sortedCaps(data.capabilities ?? []);
  const excl = sortedCaps(data.excludedCapabilities ?? []);
  if (caps.length === 0 && excl.length === 0) {
    return 'empty';
  }
  return createHash('sha256')
    .update(JSON.stringify({ capabilities: caps, excludedCapabilities: excl }))
    .digest('hex')
    .slice(0, 24);
}

export function fingerprintCapabilityList(capabilities: string[]): string {
  return createHash('sha256')
    .update([...capabilities].sort().join('|'))
    .digest('hex')
    .slice(0, 16);
}

/**
 * In-memory snapshot (refreshed by cron / global dataset job). Safe to read synchronously on requests.
 */
export function getPymthouseManifestSnapshot(): {
  data: PymthouseManifestResponse | null;
  revision: string;
} {
  return { data: globalSnapshot.data, revision: globalSnapshot.revision };
}

/**
 * HTTP fetch from PymtHouse; updates process-wide snapshot. Call from refresh pipelines only
 * (or tests with mocked fetch).
 *
 * @returns whether the manifest revision changed vs the previous snapshot (for cache busting).
 */
export async function syncPymthouseManifestSnapshot(opts?: {
  signal?: AbortSignal;
}): Promise<{ revision: string; revisionChanged: boolean }> {
  const base = getPymthouseApiV1Base();
  const publicId =
    process.env.PYMTHOUSE_PUBLIC_CLIENT_ID?.trim() || process.env.PMTHOUSE_CLIENT_ID?.trim();
  const m2mId =
    process.env.PYMTHOUSE_M2M_CLIENT_ID?.trim() || process.env.PMTHOUSE_M2M_CLIENT_ID?.trim();
  const m2mSecret =
    process.env.PYMTHOUSE_M2M_CLIENT_SECRET?.trim() || process.env.PMTHOUSE_M2M_CLIENT_SECRET?.trim();

  const prevRevision = globalSnapshot.revision;

  if (!base || !publicId || !m2mId || !m2mSecret) {
    globalSnapshot = {
      data: null,
      revision: 'unavailable',
      updatedAt: Date.now(),
    };
    return {
      revision: globalSnapshot.revision,
      revisionChanged: prevRevision !== globalSnapshot.revision,
    };
  }

  const basic = Buffer.from(`${m2mId}:${m2mSecret}`, 'utf8').toString('base64');
  const url = `${base}/apps/${encodeURIComponent(publicId)}/manifest`;
  let body: PymthouseManifestResponse | null = null;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Basic ${basic}` },
      signal: opts?.signal,
      cache: 'no-store',
    });
    if (res.ok) {
      const json = (await res.json()) as Record<string, unknown>;
      const capsRaw = json.capabilities;
      const capabilities = Array.isArray(capsRaw)
        ? capsRaw.filter(
            (c): c is PymthouseManifestCapability =>
              !!c &&
              typeof c === 'object' &&
              typeof (c as { pipeline?: unknown }).pipeline === 'string' &&
              typeof (c as { modelId?: unknown }).modelId === 'string',
          )
        : [];
      const exclRaw = json.excludedCapabilities;
      const excludedCapabilities = Array.isArray(exclRaw)
        ? exclRaw.filter(
            (c): c is PymthouseManifestCapability =>
              !!c &&
              typeof c === 'object' &&
              typeof (c as { pipeline?: unknown }).pipeline === 'string' &&
              typeof (c as { modelId?: unknown }).modelId === 'string',
          )
        : [];
      const manifestVersion =
        typeof json.manifestVersion === 'string' && json.manifestVersion.trim()
          ? json.manifestVersion.trim()
          : undefined;
      body = { capabilities, excludedCapabilities, manifestVersion };
    }
  } catch {
    body = null;
  }

  const revision =
    body?.manifestVersion ?? computeManifestRevision(body);
  globalSnapshot = {
    data: body,
    revision,
    updatedAt: Date.now(),
  };
  cache = { at: Date.now(), data: body, ttlMs: cache.ttlMs };

  return { revision, revisionChanged: revision !== prevRevision };
}

/**
 * Read manifest for request-time logic (intersection, dashboard). Uses snapshot only — no HTTP.
 * For `skipCache: true` (tests), runs a network sync first.
 */
export async function fetchPymthouseManifest(opts?: {
  skipCache?: boolean;
  signal?: AbortSignal;
}): Promise<PymthouseManifestResponse | null> {
  if (opts?.skipCache) {
    await syncPymthouseManifestSnapshot({ signal: opts.signal });
  }
  return getPymthouseManifestSnapshot().data;
}

/**
 * Split leaderboard capability string (e.g. `live-video-to-video/streamdiffusion-sdxl`)
 * into pipeline + model for manifest matching.
 */
export function parseCapabilityToPipelineModel(cap: string): {
  pipeline: string;
  modelId: string;
} {
  const trimmed = cap.trim();
  const i = trimmed.lastIndexOf('/');
  if (i <= 0) {
    return { pipeline: '*', modelId: trimmed };
  }
  return { pipeline: trimmed.slice(0, i), modelId: trimmed.slice(i + 1) };
}

function capabilityRuleMatches(
  rule: PymthouseManifestCapability,
  pipeline: string,
  modelId: string,
): boolean {
  const rP = pipeline.trim();
  const rM = modelId.trim();
  const eP = rule.pipeline.trim();
  const eM = rule.modelId.trim();
  const pipelineOk = rP === '*' || eP === '*' || eP === rP;
  const modelOk = rM === '*' || eM === '*' || eM === rM;
  return pipelineOk && modelOk;
}

/**
 * Discovery allow check against PymtHouse resolved manifest.
 *
 * When `capabilities` is non-empty (normal case), only rows in that resolved allowlist pass.
 * Excluded rows always deny. Empty/unavailable manifest fails open for integrator safety.
 */
export function isPipelineModelInManifest(
  manifest: PymthouseManifestResponse | null,
  pipeline: string,
  modelId: string,
): boolean {
  if (!manifest?.capabilities?.length) {
    return true;
  }
  for (const ex of manifest.excludedCapabilities ?? []) {
    if (capabilityRuleMatches(ex, pipeline, modelId)) {
      return false;
    }
  }
  for (const e of manifest.capabilities) {
    if (capabilityRuleMatches(e, pipeline, modelId)) {
      return true;
    }
  }
  return false;
}

export function isLeaderboardCapabilityAllowed(
  manifest: PymthouseManifestResponse | null,
  capability: string,
): boolean {
  const { pipeline, modelId } = parseCapabilityToPipelineModel(capability);
  return isPipelineModelInManifest(manifest, pipeline, modelId);
}

export function filterPlanCapabilitiesForManifest(
  capabilities: string[],
  manifest: PymthouseManifestResponse | null,
): string[] {
  return capabilities.filter((c) => isLeaderboardCapabilityAllowed(manifest, c));
}
