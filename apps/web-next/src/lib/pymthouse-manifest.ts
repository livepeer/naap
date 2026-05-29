/**
 * PymtHouse Builder app network capability manifest (pipeline + modelId).
 *
 * A process-wide snapshot is refreshed on the same cadence as leaderboard data
 * (`refreshGlobalDataset`, plans cron, and dataset cron skip still refreshes manifest).
 * Request handlers read the snapshot synchronously (no per-request HTTP to PymtHouse).
 */

import { createHash } from 'node:crypto';

import {
  computeManifestRevision,
  parseAppManifestResponse,
  type AppManifestCapability,
  type AppManifestResponse,
} from '@pymthouse/builder-sdk';
import { readPymthouseEnv } from '@pymthouse/builder-sdk/config';

import { getPmtHouseServerClient } from '@/lib/pymthouse-client';
import { getPymthouseApiV1Base } from '@/lib/pymthouse-device-initiate';

export type PymthouseManifestCapability = AppManifestCapability;
export type PymthouseManifestResponse = AppManifestResponse;

interface GlobalManifestSnapshot {
  data: PymthouseManifestResponse | null;
  revision: string;
  /** PymtHouse `ETag` from last GET/HEAD (used for conditional HEAD probes). */
  etag: string | null;
  updatedAt: number;
}

let globalSnapshot: GlobalManifestSnapshot = {
  data: null,
  revision: 'none',
  etag: null,
  updatedAt: 0,
};

/** Response `Cache-Control` for orchestrator-leaderboard discovery routes. */
export const DISCOVERY_RESPONSE_CACHE_CONTROL = 'private, no-store, must-revalidate';

function parseManifestJson(json: Record<string, unknown>): PymthouseManifestResponse {
  return parseAppManifestResponse(json);
}

function applyManifestSnapshot(
  body: PymthouseManifestResponse | null,
  etag: string | null,
): { revision: string; revisionChanged: boolean } {
  const prevRevision = globalSnapshot.revision;
  const revision = body?.manifestVersion ?? computeManifestRevision(body);
  globalSnapshot = {
    data: body,
    revision,
    etag,
    updatedAt: Date.now(),
  };
  cache = { at: Date.now(), data: body, ttlMs: cache.ttlMs };
  return { revision, revisionChanged: revision !== prevRevision };
}

/** Legacy 45s cache — superseded by snapshot; kept for tests resetting the same shape. */
let cache: { at: number; data: PymthouseManifestResponse | null; ttlMs: number } = {
  at: 0,
  data: null,
  ttlMs: 45_000,
};

export function resetPymthouseManifestCacheForTests(): void {
  cache = { at: 0, data: null, ttlMs: 45_000 };
  globalSnapshot = { data: null, revision: 'none', etag: null, updatedAt: 0 };
}

/** Test helper: inject snapshot without HTTP. */
export function seedPymthouseManifestForTests(
  data: PymthouseManifestResponse | null,
  opts?: { etag?: string | null },
): void {
  const revision = data?.manifestVersion ?? computeManifestRevision(data);
  globalSnapshot = {
    data,
    revision,
    etag: opts?.etag ?? null,
    updatedAt: Date.now(),
  };
  cache = { at: Date.now(), data, ttlMs: cache.ttlMs };
}

export { computeManifestRevision };

export function getPymthouseManifestSnapshot(): {
  data: PymthouseManifestResponse | null;
  revision: string;
} {
  return { data: globalSnapshot.data, revision: globalSnapshot.revision };
}

export function fingerprintCapabilityList(capabilities: string[]): string {
  return createHash('sha256')
    .update([...capabilities].sort((a, b) => a.localeCompare(b)).join('|'))
    .digest('hex')
    .slice(0, 16);
}

export async function syncPymthouseManifestSnapshot(opts?: {
  signal?: AbortSignal;
}): Promise<{ revision: string; revisionChanged: boolean }> {
  if (!readPymthouseEnv()) {
    const unavailable = applyManifestSnapshot(null, null);
    return { revision: 'unavailable', revisionChanged: unavailable.revisionChanged };
  }

  try {
    const result = await getPmtHouseServerClient().getAppManifest({
      ifNoneMatch: globalSnapshot.etag ?? undefined,
      signal: opts?.signal,
    });
    if (result.notModified) {
      return { revision: globalSnapshot.revision, revisionChanged: false };
    }
    return applyManifestSnapshot(result.manifest, result.etag);
  } catch {
    return { revision: globalSnapshot.revision, revisionChanged: false };
  }
}

/**
 * Lightweight manifest freshness check for discovery handlers (HEAD + conditional GET).
 */
export async function ensurePymthouseManifestFresh(opts?: {
  signal?: AbortSignal;
  onRevisionChanged?: () => void;
}): Promise<{ revision: string; revisionChanged: boolean }> {
  const result = await syncPymthouseManifestSnapshot(opts);
  if (result.revisionChanged) {
    opts?.onRevisionChanged?.();
  }
  return result;
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
    return { pipeline: '', modelId: trimmed };
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
  const pipelineOk = rP === '*' || eP === '*' || (eP !== '' && eP === rP);
  const modelOk = rM === '*' || eM === '*' || eM === rM;
  return pipelineOk && modelOk;
}

function capabilityRuleMatchesCapability(
  rule: PymthouseManifestCapability,
  capability: string,
): boolean {
  const normalizedCapability = capability.trim();
  const pipeline = rule.pipeline.trim();
  const modelId = rule.modelId.trim();
  if (!normalizedCapability || !pipeline || !modelId) {
    return false;
  }
  if (pipeline === '*') {
    return modelId === '*' || normalizedCapability.endsWith(`/${modelId}`);
  }
  if (modelId === '*') {
    return normalizedCapability === pipeline || normalizedCapability.startsWith(`${pipeline}/`);
  }
  return normalizedCapability === `${pipeline}/${modelId}`;
}

/**
 * Opt-in fail-open when manifest is missing or empty. Narrow scope: set only for
 * controlled environments (e.g. local dev). Emits a high-severity audit log when used.
 */
export function isMissingManifestFailOpenEnabled(): boolean {
  const raw = process.env.PYMTHOUSE_ALLOW_MISSING_MANIFEST_FAIL_OPEN?.trim();
  return raw === '1' || raw?.toLowerCase() === 'true';
}

function manifestUrlForAudit(): string | undefined {
  const base = getPymthouseApiV1Base();
  const publicId =
    process.env.PYMTHOUSE_PUBLIC_CLIENT_ID?.trim() || process.env.PMTHOUSE_CLIENT_ID?.trim();
  if (!base || !publicId) return undefined;
  return `${base}/apps/${encodeURIComponent(publicId)}/manifest`;
}

function logMissingManifestFailOpen(context: {
  manifestUrl?: string;
  manifestId?: string;
}): void {
  console.error('[pymthouse-manifest] AUDIT: missing or empty manifest fail-open enabled', context);
}

/**
 * Discovery allow check against PymtHouse exclusions.
 *
 * PymtHouse's catalog can be smaller than NaaP's catalog, so `capabilities` is
 * informational. The Network Discovery plan is a denylist: explicitly excluded
 * rows deny and every other NaaP capability is allowed. A missing manifest still
 * denies by default; set `PYMTHOUSE_ALLOW_MISSING_MANIFEST_FAIL_OPEN=1` only in
 * controlled environments to restore fail-open behavior (audited).
 */
export function isPipelineModelInManifest(
  manifest: PymthouseManifestResponse | null,
  pipeline: string,
  modelId: string,
): boolean {
  if (!manifest) {
    if (isMissingManifestFailOpenEnabled()) {
      const publicId =
        process.env.PYMTHOUSE_PUBLIC_CLIENT_ID?.trim() || process.env.PMTHOUSE_CLIENT_ID?.trim();
      logMissingManifestFailOpen({
        manifestUrl: manifestUrlForAudit(),
        manifestId: publicId,
      });
      return true;
    }
    return false;
  }

  for (const ex of manifest.excludedCapabilities ?? []) {
    if (capabilityRuleMatches(ex, pipeline, modelId)) {
      return false;
    }
  }
  return true;
}

export function isLeaderboardCapabilityAllowed(
  manifest: PymthouseManifestResponse | null,
  capability: string,
): boolean {
  if (!manifest) {
    return isPipelineModelInManifest(manifest, '', capability);
  }
  for (const ex of manifest.excludedCapabilities ?? []) {
    if (capabilityRuleMatchesCapability(ex, capability)) {
      return false;
    }
  }
  return true;
}

export function filterPlanCapabilitiesForManifest(
  capabilities: string[],
  manifest: PymthouseManifestResponse | null,
): string[] {
  return capabilities.filter((c) => isLeaderboardCapabilityAllowed(manifest, c));
}
