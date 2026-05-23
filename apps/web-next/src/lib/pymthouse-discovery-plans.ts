/**
 * Fetch app-scoped discovery policy from PymtHouse and merge with NaaP user preferences.
 * Does not import PymtHouse runtime or NaaP data sources — HTTP + local merge only.
 */

const TRAILING_SLASH = /\/+$/;

export type DiscoverySortBy = "slaScore" | "latency" | "price" | "swapRate" | "avail";

export interface DiscoveryPolicyFilters {
  gpuRamGbMin?: number;
  gpuRamGbMax?: number;
  priceMax?: number;
  maxAvgLatencyMs?: number;
  maxSwapRatio?: number;
}

export interface DiscoveryPolicy {
  topN?: number;
  sortBy?: DiscoverySortBy;
  slaMinScore?: number;
  slaWeights?: {
    latency?: number;
    swapRate?: number;
    price?: number;
  };
  filters?: DiscoveryPolicyFilters;
}

export interface PymthouseDiscoveryCapability {
  pipeline: string;
  modelId: string;
  discoveryPolicy: DiscoveryPolicy | null;
}

export interface PymthouseDiscoveryPlanRow {
  id: string;
  name: string;
  status: string;
  discoveryPolicy: DiscoveryPolicy | null;
  capabilities: PymthouseDiscoveryCapability[];
}

export interface PymthouseDiscoveryPlansResponse {
  plans: PymthouseDiscoveryPlanRow[];
}

/** Resolve Builder API base (`…/api/v1`) from `PYMTHOUSE_ISSUER_URL` (`…/api/v1/oidc`). */
export function getPymthouseApiV1Base(): string | null {
  const raw = process.env.PYMTHOUSE_ISSUER_URL?.trim();
  if (!raw) return null;
  const noTrail = raw.replace(TRAILING_SLASH, "");
  return noTrail.replace(/\/oidc\/?$/i, "");
}

let cache: { at: number; data: PymthouseDiscoveryPlansResponse | null; ttlMs: number } = {
  at: 0,
  data: null,
  ttlMs: 45_000,
};

export function resetPymthouseDiscoveryPlansCacheForTests(): void {
  cache = { at: 0, data: null, ttlMs: 45_000 };
}

/**
 * Map Builder `GET /api/v1/apps/{id}/plans` JSON to the legacy discovery-plans shape.
 * Drops the Network Price default row (`isNetworkDefault`) and inactive plans.
 */
export function mapPymthousePlansResponse(raw: unknown): PymthouseDiscoveryPlansResponse | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const plansRaw = (raw as { plans?: unknown }).plans;
  if (!Array.isArray(plansRaw)) return null;

  const plans: PymthouseDiscoveryPlanRow[] = [];

  for (const row of plansRaw) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    if (r.status !== "active") continue;
    if (r.isNetworkDefault === true) continue;

    const id = typeof r.id === "string" ? r.id : "";
    const name = typeof r.name === "string" ? r.name : "";
    const status = typeof r.status === "string" ? r.status : "active";
    if (!id) continue;

    const discoveryPolicy =
      r.discoveryPolicy === null || r.discoveryPolicy === undefined
        ? null
        : (r.discoveryPolicy as DiscoveryPolicy);

    const capabilities: PymthouseDiscoveryCapability[] = [];
    const capsRaw = r.capabilities;
    if (Array.isArray(capsRaw)) {
      for (const c of capsRaw) {
        if (!c || typeof c !== "object") continue;
        const cc = c as Record<string, unknown>;
        const pipeline = typeof cc.pipeline === "string" ? cc.pipeline : "";
        const modelId = typeof cc.modelId === "string" ? cc.modelId : "";
        if (!pipeline || !modelId) continue;
        const capPolicy =
          cc.discoveryPolicy === null || cc.discoveryPolicy === undefined
            ? null
            : (cc.discoveryPolicy as DiscoveryPolicy);
        capabilities.push({ pipeline, modelId, discoveryPolicy: capPolicy });
      }
    }

    plans.push({ id, name, status, discoveryPolicy, capabilities });
  }

  return { plans };
}

/**
 * GET `/api/v1/apps/{publicClientId}/plans` using M2M Basic auth. Pipeline/model caps use `/manifest`.
 * Returns null if env incomplete or request fails.
 */
export async function fetchPymthouseDiscoveryPlans(opts?: {
  skipCache?: boolean;
  signal?: AbortSignal;
}): Promise<PymthouseDiscoveryPlansResponse | null> {
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

  const now = Date.now();
  if (!opts?.skipCache && cache.data && now - cache.at < cache.ttlMs) {
    return cache.data;
  }

  const basic = Buffer.from(`${m2mId}:${m2mSecret}`, "utf8").toString("base64");
  const url = `${base}/apps/${encodeURIComponent(publicId)}/plans`;
  let body: PymthouseDiscoveryPlansResponse | null;
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Basic ${basic}` },
      signal: opts?.signal,
      cache: "no-store",
    });
    if (!res.ok) {
      return null;
    }
    const json: unknown = await res.json();
    body = mapPymthousePlansResponse(json);
  } catch {
    return null;
  }
  if (!body || !Array.isArray(body.plans)) {
    return null;
  }
  cache = { at: now, data: body, ttlMs: cache.ttlMs };
  return body;
}

/**
 * Conservative merge: app policy is an upper bound; user refines within it.
 * (Same semantics as PymtHouse `mergeDiscoveryPolicies`.)
 */
export function mergeDiscoveryPolicies(
  app: DiscoveryPolicy | null,
  user: DiscoveryPolicy | null,
): DiscoveryPolicy | null {
  if (!app && !user) return null;
  if (!app) return user ? { ...user } : null;
  if (!user) return { ...app };

  const out: DiscoveryPolicy = { ...app };

  if (user.topN !== undefined) {
    out.topN = Math.min(app.topN ?? Number.POSITIVE_INFINITY, user.topN);
  }

  if (user.sortBy !== undefined) {
    out.sortBy = user.sortBy;
  }

  if (user.slaMinScore !== undefined) {
    out.slaMinScore = Math.max(app.slaMinScore ?? user.slaMinScore, user.slaMinScore);
  }

  const mergedWeights = { ...app.slaWeights, ...user.slaWeights };
  if (Object.keys(mergedWeights).length > 0) {
    out.slaWeights = mergedWeights;
  } else {
    delete out.slaWeights;
  }

  const af = app.filters;
  const uf = user.filters;
  if (af || uf) {
    const f: DiscoveryPolicyFilters = {};
    const gminA = af?.gpuRamGbMin;
    const gminU = uf?.gpuRamGbMin;
    if (gminA !== undefined || gminU !== undefined) {
      f.gpuRamGbMin = Math.max(gminA ?? 0, gminU ?? 0);
    }
    const gmaxA = af?.gpuRamGbMax;
    const gmaxU = uf?.gpuRamGbMax;
    if (gmaxA !== undefined && gmaxU !== undefined) f.gpuRamGbMax = Math.min(gmaxA, gmaxU);
    else if (gmaxU !== undefined) f.gpuRamGbMax = gmaxU;
    else if (gmaxA !== undefined) f.gpuRamGbMax = gmaxA;

    const pA = af?.priceMax;
    const pU = uf?.priceMax;
    if (pA !== undefined && pU !== undefined) f.priceMax = Math.min(pA, pU);
    else if (pU !== undefined) f.priceMax = pU;
    else if (pA !== undefined) f.priceMax = pA;

    const lA = af?.maxAvgLatencyMs;
    const lU = uf?.maxAvgLatencyMs;
    if (lA !== undefined && lU !== undefined) f.maxAvgLatencyMs = Math.min(lA, lU);
    else if (lU !== undefined) f.maxAvgLatencyMs = lU;
    else if (lA !== undefined) f.maxAvgLatencyMs = lA;

    const sA = af?.maxSwapRatio;
    const sU = uf?.maxSwapRatio;
    if (sA !== undefined && sU !== undefined) f.maxSwapRatio = Math.min(sA, sU);
    else if (sU !== undefined) f.maxSwapRatio = sU;
    else if (sA !== undefined) f.maxSwapRatio = sA;

    if (Object.keys(f).length > 0) out.filters = f;
    else delete out.filters;
  }

  return out;
}
