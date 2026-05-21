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
import {
  getPymthouseApiV1Base,
  getPymthouseManifestSnapshot,
  syncPymthouseManifestSnapshot,
} from '@/lib/pymthouse-manifest';

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
  ) ?? 'pymthouse';
  let billingProviderSlug = requestedBillingProviderSlug;

  const publicId =
    process.env.PYMTHOUSE_PUBLIC_CLIENT_ID?.trim() || process.env.PMTHOUSE_CLIENT_ID?.trim();
  const m2mId =
    process.env.PYMTHOUSE_M2M_CLIENT_ID?.trim() || process.env.PMTHOUSE_M2M_CLIENT_ID?.trim();
  const m2mSecret =
    process.env.PYMTHOUSE_M2M_CLIENT_SECRET?.trim() || process.env.PMTHOUSE_M2M_CLIENT_SECRET?.trim();
  const pymthouseConfigured = Boolean(
    getPymthouseApiV1Base() &&
    publicId &&
    m2mId &&
    m2mSecret,
  );

  let manifestChecked = false;
  let manifestAvailable = false;
  if (requestedBillingProviderSlug === 'pymthouse') {
    manifestChecked = true;
    if (pymthouseConfigured) {
      await syncPymthouseManifestSnapshot();
      manifestAvailable = getPymthouseManifestSnapshot().data != null;
    } else {
      billingProviderSlug = 'daydream';
    }
  }

  const catalog = await getDashboardPipelineCatalog();
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

  return success({
    requestedBillingProviderSlug,
    billingProviderSlug,
    pymthouseConfigured,
    manifestChecked,
    manifestAvailable,
    pipelines,
    capabilities: pipelines.flatMap((p) => p.models.map((m) => m.capability)),
  });
}
