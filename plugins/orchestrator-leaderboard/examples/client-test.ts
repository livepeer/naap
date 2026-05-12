/**
 * Orchestrator Leaderboard — TypeScript SDK Client Example
 *
 * Demonstrates how an external service or SDK can use the leaderboard API
 * to get a ranked list of orchestrator URLs, with client-side caching.
 *
 * Usage:
 *   NAAP_API_URL=https://your-host NAAP_API_KEY=gw_xxx npx tsx client-test.ts
 */

const NAAP_API_URL = process.env.NAAP_API_URL || 'http://localhost:3000';
const API_KEY = process.env.NAAP_API_KEY;

if (!API_KEY) {
  console.error('Set NAAP_API_KEY environment variable');
  process.exit(1);
}

interface OrchestratorRow {
  orchUri: string;
  gpuName: string;
  gpuGb: number;
  avail: number;
  totalCap: number;
  pricePerUnit: number;
  bestLatMs: number | null;
  avgLatMs: number | null;
  swapRatio: number | null;
  avgAvail: number | null;
  slaScore?: number;
}

// Client-side cache respecting server Cache-Control
const cache = new Map<string, { data: OrchestratorRow[]; expiresAt: number }>();

async function getTopOrchestrators(
  capability: string,
  topN = 10,
  options?: {
    filters?: Record<string, number>;
    slaWeights?: { latency?: number; swapRate?: number; price?: number };
  }
): Promise<OrchestratorRow[]> {
  const cacheKey = `${capability}:${topN}:${JSON.stringify(options || {})}`;
  const cached = cache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    console.log(`  [cache] HIT for ${cacheKey}`);
    return cached.data;
  }

  const body: Record<string, unknown> = { capability, topN };
  if (options?.filters) body.filters = options.filters;
  if (options?.slaWeights) body.slaWeights = options.slaWeights;

  const res = await fetch(`${NAAP_API_URL}/api/v1/orchestrator-leaderboard/rank`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => 'unknown error')}`);
  }

  const json = await res.json();
  if (!json.success) {
    throw new Error(`API error: ${json.error?.message || res.status}`);
  }

  const cc = res.headers.get('Cache-Control') || '';
  const maxAge = parseInt(cc.match(/max-age=(\d+)/)?.[1] || '10', 10);
  cache.set(cacheKey, { data: json.data, expiresAt: Date.now() + maxAge * 1000 });

  console.log(`  [cache] MISS — server X-Cache: ${res.headers.get('X-Cache')}, age: ${res.headers.get('X-Cache-Age')}s`);
  return json.data;
}

async function main() {
  console.log('--- Orchestrator Leaderboard Client Test ---\n');

  // 1. Basic query
  console.log('1. Top 5 orchestrators for streamdiffusion-sdxl:');
  const top5 = await getTopOrchestrators('streamdiffusion-sdxl', 5);
  for (const o of top5) {
    console.log(`   ${o.orchUri} — ${o.gpuName} ${o.gpuGb}GB — lat:${o.bestLatMs ?? '?'}ms — price:${o.pricePerUnit}`);
  }

  // 2. Same query again — should hit client cache
  console.log('\n2. Same query (should use client cache):');
  const cached = await getTopOrchestrators('streamdiffusion-sdxl', 5);
  console.log(`   Got ${cached.length} results from cache`);

  // 3. With filters
  console.log('\n3. With filters (min 16GB GPU, max 500ms latency):');
  const filtered = await getTopOrchestrators('streamdiffusion-sdxl', 10, {
    filters: { gpuRamGbMin: 16, maxAvgLatencyMs: 500 },
  });
  console.log(`   Got ${filtered.length} results`);

  // 4. With custom SLA weights
  console.log('\n4. With custom SLA weights (latency-heavy):');
  const slaRanked = await getTopOrchestrators('streamdiffusion-sdxl', 5, {
    slaWeights: { latency: 0.7, swapRate: 0.2, price: 0.1 },
  });
  for (const o of slaRanked) {
    console.log(`   ${o.orchUri} — SLA: ${o.slaScore?.toFixed(3)} — lat:${o.bestLatMs ?? '?'}ms`);
  }

  // 5. Extract just the URLs an SDK needs
  console.log('\n5. Orchestrator URLs to reach:');
  const urls = top5.map((o) => o.orchUri);
  console.log(`   ${JSON.stringify(urls)}`);
}

main().catch(console.error);
