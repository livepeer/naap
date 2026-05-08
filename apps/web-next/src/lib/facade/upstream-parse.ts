/**
 * Helpers for NAAP Analytics API v1 combined payloads (see repo openapi.yaml).
 */

import type {
  DashboardKPI,
  DashboardJobsOverview,
  DashboardKPIWithRequests,
  DashboardJobsByPipelineRow,
  DashboardJobsByCapabilityRow,
} from '@naap/plugin-sdk';

/** Raw streaming pipeline row from GET /v1/dashboard/pipelines */
export interface DashboardPipelineRow {
  name: string;
  sessions: number;
  mins: number;
  avgFps: number;
  modelMins?: unknown;
}

export function parseDashboardKpiBody(body: unknown): {
  kpi: DashboardKPI;
  requests?: DashboardJobsOverview;
} {
  if (body && typeof body === 'object' && 'streaming' in body) {
    const o = body as { streaming?: DashboardKPI; requests?: DashboardJobsOverview };
    if (o.streaming && typeof o.streaming === 'object') {
      return {
        kpi: o.streaming,
        requests: o.requests,
      };
    }
  }
  return { kpi: body as DashboardKPI };
}

export function parseDashboardKpiWithRequests(body: unknown): DashboardKPIWithRequests {
  const { kpi, requests } = parseDashboardKpiBody(body);
  return requests ? { ...kpi, requests } : kpi;
}

export function parseDashboardPipelinesBody(body: unknown): {
  streaming: DashboardPipelineRow[];
  requests?: {
    by_pipeline: DashboardJobsByPipelineRow[];
    by_capability: DashboardJobsByCapabilityRow[];
  };
} {
  if (Array.isArray(body)) {
    return { streaming: body as DashboardPipelineRow[] };
  }
  if (body && typeof body === 'object' && 'streaming' in body) {
    const o = body as {
      streaming?: DashboardPipelineRow[];
      requests?: {
        by_pipeline?: DashboardJobsByPipelineRow[];
        by_capability?: DashboardJobsByCapabilityRow[];
      };
    };
    const streaming = Array.isArray(o.streaming) ? o.streaming : [];
    const req = o.requests;
    return {
      streaming,
      requests:
        req && typeof req === 'object'
          ? {
              by_pipeline: Array.isArray(req.by_pipeline) ? req.by_pipeline : [],
              by_capability: Array.isArray(req.by_capability) ? req.by_capability : [],
            }
          : undefined,
    };
  }
  return { streaming: [] };
}
