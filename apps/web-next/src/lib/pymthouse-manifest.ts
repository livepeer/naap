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
  /** PymtHouse-local resolved set. NaaP treats this as informational, not a complete allowlist. */
  capabilities: PymthouseManifestCapability[];
  /** Raw exclusions from the Network Price plan. NaaP denies these and allows everything else. */
  excludedCapabilities?: PymthouseManifestCapability[];
  /** Server-computed revision; used for cache busting when present. */
  manifestVersion?: string;
}

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

interface PymthouseManifestCredentials {
  base: string;
  publicId: string;
  m2mId: string;
  m2mSecret: string;
  basic: string;
  url: string;
}

function getPymthouseManifestCredentials(): PymthouseManifestCredentials | null {
  const base = getPymthouseApiV1Base();
  const publicId =
    process.env.PYMTHOUSE_PUBLIC_CLIENT_ID?.trim() || process.env.PMTHOUSE_CLIENT_ID?.trim();
  const m2mId =
    process.env.PYMTHOUSE_M2M_CLIENT_ID?.trim() || process.env.PMTHOUSE_M2M_CLIENT_ID?.trim();
  const m2mSecret =
    process.env.PYMTHOUSE_M2M_CLIENT_SECRET?.trim() || process.env.PMTHOUSE_M2M_CLIENT_SECRET?.trim();
  if (!base || !publicId || !m2mId || !m2mSecret) {
    return null;
  }
  const basic = Buffer.from(`${m2mId}:${m2mSecret}`, 'utf8').toString('base64');
  return {
    base,
    publicId,
    m2mId,
    m2mSecret,
    basic,
    url: `${base}/apps/${encodeURIComponent(publicId)}/manifest`,
  };
}

function parseManifestJson(json: Record<string, unknown>): PymthouseManifestResponse {
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
  return { capabilities, excludedCapabilities, manifestVersion };
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

async function probeManifestUnchanged(
  creds: PymthouseManifestCredentials,
  signal?: AbortSignal,
): Promise<boolean> {
  if (!globalSnapshot.etag) {
    return false;
  }
  try {
    const res = await fetch(creds.url, {
      method: 'HEAD',
      headers: {
        Authorization: `Basic ${creds.basic}`,
        'If-None-Match': globalSnapshot.etag,
      },
      signal,
      cache: 'no-store',
    });
    if (res.status === 304) {
      return true;
    }
    const nextEtag = res.headers.get('etag')?.trim();
    if (res.ok && nextEtag && nextEtag === globalSnapshot.etag) {
      return true;
    }
  } catch {
    return false;
  }
  return false;
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

export function getPymthouseApiV1Base(): string | null {
  const raw = process.env.PYMTHOUSE_ISSUER_URL?.trim();
  if (!raw) return null;
  const noTrail = raw.replace(TRAILING_SLASH, '');
  return noTrail.replace(/\/oidc\/?$/i, '');
}

function sortedCaps(caps: PymthouseManifestCapability[]): PymthouseManifestCapability[] {
  return [...caps].sort((a, b) => {
    const p = a.pipeline.localeCompare(b.pipeline);
    return p === 0 ? a.modelId.localeCompare(b.modelId) : p;
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
    .update([...capabilities].sort((a, b) => a.localeCompare(b)).join('|'))
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
  const creds = getPymthouseManifestCredentials();

  if (!creds) {
    const unavailable = applyManifestSnapshot(null, null);
    return { revision: 'unavailable', revisionChanged: unavailable.revisionChanged };
  }

  if (globalSnapshot.data != null && (await probeManifestUnchanged(creds, opts?.signal))) {
    return { revision: globalSnapshot.revision, revisionChanged: false };
  }

  const url = creds.url;
  let body: PymthouseManifestResponse | null = null;
  let etag: string | null = null;
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { Authorization: `Basic ${creds.basic}` },
      signal: opts?.signal,
      cache: 'no-store',
    });
    etag = res.headers.get('etag')?.trim() || null;
    if (res.ok) {
      const json = (await res.json()) as Record<string, unknown>;
      body = parseManifestJson(json);
    }
  } catch {
    body = null;
    etag = null;
  }

  return applyManifestSnapshot(body, etag);
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
