/**
 * GET /api/v1/orchestrator-leaderboard/capability-catalog
 *
 * Returns provider-scoped, friendly pipeline/model capability tags for
 * discovery plan creation/editing UI.
 */

export const runtime = 'nodejs';

import { NextRequest } from 'next/server';
import { authorize } from '@/lib/gateway/authorize';
import { success, errors } from '@/lib/api/response';
import { normalizeBillingProviderSlug } from '@/lib/orchestrator-leaderboard/provider-restrictions';
import { getDatasetCapabilities } from '@/lib/orchestrator-leaderboard/global-dataset';
import { DISCOVERY_RESPONSE_CACHE_CONTROL } from '@/lib/orchestrator-leaderboard/discovery-constants';

interface CapabilityCatalogModel {
  id: string;
  label: string;
  capability: string;
}

interface CapabilityCatalogPipeline {
  id: string;
  name: string;
  models: CapabilityCatalogModel[];
}

export async function GET(request: NextRequest): Promise<Response> {
  const auth = await authorize(request);
  if (!auth) {
    return errors.unauthorized('Missing or invalid authentication');
  }

  const hasBillingProviderSlug = request.nextUrl.searchParams.has('billingProviderSlug');
  const requestedBillingProviderSlug = hasBillingProviderSlug
    ? normalizeBillingProviderSlug(request.nextUrl.searchParams.get('billingProviderSlug'))
    : 'daydream';
  if (!requestedBillingProviderSlug) {
    return errors.badRequest('Invalid billingProviderSlug');
  }
  const manifestOnly = request.nextUrl.searchParams.get('manifestOnly') === '1';
  const capabilitiesToValidate = request.nextUrl.searchParams.getAll('capability');
  const billingProviderSlug = requestedBillingProviderSlug;

  // PR #337 is Daydream-only; keep manifest response fields stable as false.
  const manifestChecked = false;
  const manifestAvailable = false;
  const pymthouseConfigured = false;

  if (manifestOnly) {
    // Daydream has no manifest; pass all requested capabilities through unfiltered.
    const response = success({
      requestedBillingProviderSlug,
      billingProviderSlug,
      pymthouseConfigured,
      manifestChecked,
      manifestAvailable,
      pipelines: [],
      capabilities: [],
      filteredCapabilities: capabilitiesToValidate,
    });
    response.headers.set('Cache-Control', DISCOVERY_RESPONSE_CACHE_CONTROL);
    return response;
  }

  // Build the pipeline catalog from the leaderboard dataset (same source as plan evaluation).
  // Capabilities are stored as "{pipelineId}/{modelId}"; capabilities without a slash are
  // treated as standalone entries using the full string as both pipeline and model.
  const allCapabilities = await getDatasetCapabilities();

  const pipelineMap = new Map<string, CapabilityCatalogModel[]>();
  for (const capability of allCapabilities) {
    const slashIdx = capability.indexOf('/');
    const pipelineId = slashIdx > 0 ? capability.slice(0, slashIdx) : capability;
    const modelId = slashIdx > 0 ? capability.slice(slashIdx + 1) : capability;
    const models = pipelineMap.get(pipelineId) ?? [];
    models.push({ id: modelId, label: modelId, capability });
    pipelineMap.set(pipelineId, models);
  }

  const pipelines: CapabilityCatalogPipeline[] = [];
  for (const [pipelineId, models] of pipelineMap) {
    models.sort((a, b) => a.id.localeCompare(b.id));
    pipelines.push({ id: pipelineId, name: pipelineId, models });
  }

  pipelines.sort((a, b) => a.name.localeCompare(b.name));

  const response = success({
    requestedBillingProviderSlug,
    billingProviderSlug,
    pymthouseConfigured,
    manifestChecked,
    manifestAvailable,
    pipelines,
    capabilities: pipelines.flatMap((p) => p.models.map((m) => m.capability)),
  });
  response.headers.set('Cache-Control', DISCOVERY_RESPONSE_CACHE_CONTROL);
  return response;
}
