/**
 * PymtHouse Builder discovery allowlist (pipeline + modelId).
 *
 * A process-wide snapshot is refreshed on the same cadence as leaderboard data
 * (`refreshGlobalDataset`, plans cron, and dataset cron skip still refreshes allowlist).
 * Request handlers read the snapshot synchronously (no per-request HTTP to PymtHouse).
 */

import { createHash } from 'node:crypto';

const TRAILING_SLASH = /\/+$/;

export interface PymthouseDiscoveryAllowlistCapability {
  pipeline: string;
  modelId: string;
}

export interface PymthouseDiscoveryAllowlistResponse {
  /** Resolved discoverable `(pipeline, modelId)` pairs (catalog minus Network Price exclusions). */
  capabilities: PymthouseDiscoveryAllowlistCapability[];
  /** Raw exclusions from the Network Price plan (same contract as Builder `PUT`). */
  excludedCapabilities?: PymthouseDiscoveryAllowlistCapability[];
}

interface GlobalAllowlistSnapshot {
  data: PymthouseDiscoveryAllowlistResponse | null;
  revision: string;
  updatedAt: number;
}

let globalSnapshot: GlobalAllowlistSnapshot = {
  data: null,
  revision: 'none',
  updatedAt: 0,
};

/** Legacy 45s cache — superseded by snapshot; kept for tests resetting the same shape. */
let cache: { at: number; data: PymthouseDiscoveryAllowlistResponse | null; ttlMs: number } = {
  at: 0,
  data: null,
  ttlMs: 45_000,
};

export function resetPymthouseDiscoveryAllowlistCacheForTests(): void {
  cache = { at: 0, data: null, ttlMs: 45_000 };
  globalSnapshot = { data: null, revision: 'none', updatedAt: 0 };
}

/** Test helper: inject snapshot without HTTP. */
export function seedPymthouseDiscoveryAllowlistForTests(
  data: PymthouseDiscoveryAllowlistResponse | null,
): void {
  globalSnapshot = {
    data,
    revision: computeAllowlistRevision(data),
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

function sortedCaps(caps: PymthouseDiscoveryAllowlistCapability[]): PymthouseDiscoveryAllowlistCapability[] {
  return [...caps].sort((a, b) => {
    const p = a.pipeline.localeCompare(b.pipeline);
    return p !== 0 ? p : a.modelId.localeCompare(b.modelId);
  });
}

export function computeAllowlistRevision(
  data: PymthouseDiscoveryAllowlistResponse | null,
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
export function getPymthouseDiscoveryAllowlistSnapshot(): {
  data: PymthouseDiscoveryAllowlistResponse | null;
  revision: string;
} {
  return { data: globalSnapshot.data, revision: globalSnapshot.revision };
}

/**
 * HTTP fetch from PymtHouse; updates process-wide snapshot. Call from refresh pipelines only
 * (or tests with mocked fetch).
 *
 * @returns whether the allowlist revision changed vs the previous snapshot (for cache busting).
 */
export async function syncPymthouseDiscoveryAllowlistSnapshot(opts?: {
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
  const url = `${base}/apps/${encodeURIComponent(publicId)}/discovery-allowlist`;
  let body: PymthouseDiscoveryAllowlistResponse | null = null;
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
            (c): c is PymthouseDiscoveryAllowlistCapability =>
              !!c &&
              typeof c === 'object' &&
              typeof (c as { pipeline?: unknown }).pipeline === 'string' &&
              typeof (c as { modelId?: unknown }).modelId === 'string',
          )
        : [];
      const exclRaw = json.excludedCapabilities;
      const excludedCapabilities = Array.isArray(exclRaw)
        ? exclRaw.filter(
            (c): c is PymthouseDiscoveryAllowlistCapability =>
              !!c &&
              typeof c === 'object' &&
              typeof (c as { pipeline?: unknown }).pipeline === 'string' &&
              typeof (c as { modelId?: unknown }).modelId === 'string',
          )
        : [];
      body = { capabilities, excludedCapabilities };
    }
  } catch {
    body = null;
  }

  const revision = computeAllowlistRevision(body);
  globalSnapshot = {
    data: body,
    revision,
    updatedAt: Date.now(),
  };
  cache = { at: Date.now(), data: body, ttlMs: cache.ttlMs };

  return { revision, revisionChanged: revision !== prevRevision };
}

/**
 * Read allowlist for request-time logic (intersection, dashboard). Uses snapshot only — no HTTP.
 * For `skipCache: true` (tests), runs a network sync first.
 */
export async function fetchPymthouseDiscoveryAllowlist(opts?: {
  skipCache?: boolean;
  signal?: AbortSignal;
}): Promise<PymthouseDiscoveryAllowlistResponse | null> {
  if (opts?.skipCache) {
    await syncPymthouseDiscoveryAllowlistSnapshot({ signal: opts.signal });
  }
  return getPymthouseDiscoveryAllowlistSnapshot().data;
}

/**
 * Split leaderboard capability string (e.g. `live-video-to-video/streamdiffusion-sdxl`)
 * into pipeline + model for allowlist matching.
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

export function isPipelineModelInAllowlist(
  allowlist: PymthouseDiscoveryAllowlistResponse | null,
  pipeline: string,
  modelId: string,
): boolean {
  if (!allowlist?.capabilities?.length) {
    return true;
  }
  const rP = pipeline.trim();
  const rM = modelId.trim();
  for (const e of allowlist.capabilities) {
    const eP = e.pipeline.trim();
    const eM = e.modelId.trim();
    const pipelineOk =
      rP === '*' || eP === '*' || eP === rP;
    const modelOk =
      rM === '*' || eM === '*' || eM === rM;
    if (pipelineOk && modelOk) {
      return true;
    }
  }
  return false;
}

export function isLeaderboardCapabilityAllowed(
  allowlist: PymthouseDiscoveryAllowlistResponse | null,
  capability: string,
): boolean {
  const { pipeline, modelId } = parseCapabilityToPipelineModel(capability);
  return isPipelineModelInAllowlist(allowlist, pipeline, modelId);
}

export function filterPlanCapabilitiesForAllowlist(
  capabilities: string[],
  allowlist: PymthouseDiscoveryAllowlistResponse | null,
): string[] {
  return capabilities.filter((c) => isLeaderboardCapabilityAllowed(allowlist, c));
}
