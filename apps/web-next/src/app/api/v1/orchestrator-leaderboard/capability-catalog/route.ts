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
import { getDashboardPipelineCatalog } from '@/lib/facade';
import { isCapabilityAllowedForProvider, normalizeBillingProviderSlug } from '@/lib/orchestrator-leaderboard/provider-restrictions';
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

  const requestedBillingProviderSlug = normalizeBillingProviderSlug(
    request.nextUrl.searchParams.get('billingProviderSlug'),
  ) ?? 'daydream';
  const manifestOnly = request.nextUrl.searchParams.get('manifestOnly') === '1';
  const capabilitiesToValidate = request.nextUrl.searchParams.getAll('capability');
  let billingProviderSlug = requestedBillingProviderSlug;

  // PR #337 is Daydream-only; keep manifest response fields stable as false.
  let manifestChecked = false;
  let manifestAvailable = false;
  const pymthouseConfigured = false;

  if (manifestOnly) {
    const response = success({
      requestedBillingProviderSlug,
      billingProviderSlug,
      pymthouseConfigured,
      manifestChecked,
      manifestAvailable,
      pipelines: [],
      capabilities: [],
      filteredCapabilities: capabilitiesToValidate.filter((capability) =>
        isCapabilityAllowedForProvider(capability, billingProviderSlug),
      ),
    });
    response.headers.set('Cache-Control', DISCOVERY_RESPONSE_CACHE_CONTROL);
    return response;
  }

  const refresh = request.nextUrl.searchParams.get('refresh') === '1';
  const catalog = await getDashboardPipelineCatalog(
    refresh ? { bypassCache: true } : undefined,
  );
  const pipelines: CapabilityCatalogPipeline[] = [];

  for (const pipeline of catalog) {
    const models = (pipeline.models ?? [])
      .map((modelId) => modelId.trim())
      .filter(Boolean)
      .filter((modelId) =>
        isCapabilityAllowedForProvider(`${pipeline.id}/${modelId}`, billingProviderSlug),
      )
      .sort((a, b) => a.localeCompare(b))
      .map((modelId) => ({
        id: modelId,
        label: modelId,
        capability: `${pipeline.id}/${modelId}`,
      }));

    if (models.length === 0) {
      continue;
    }

    pipelines.push({
      id: pipeline.id,
      name: pipeline.name || pipeline.id,
      models,
    });
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
