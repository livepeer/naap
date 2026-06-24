/** @vitest-environment node */

import { describe, expect, it } from 'vitest';

import type { PymthouseDiscoveryPlanRow } from '@/lib/pymthouse-discovery-plans';
import {
  AUTO_DISCOVERY_DEFAULT_TOP_N,
  buildAutoDiscoveryPlanId,
  computeProviderPlanRevision,
  planRowToCapabilities,
  toAutoDiscoveryPlanFields,
} from './auto-discovery-plan';

const ROW: PymthouseDiscoveryPlanRow = {
  id: 'plan_basic',
  name: 'Basic',
  status: 'active',
  discoveryPolicy: null,
  capabilities: [
    { pipeline: 'live-video-to-video', modelId: 'scope', discoveryPolicy: null },
    { pipeline: 'image-to-image', modelId: 'nano-banana', discoveryPolicy: null },
  ],
};

describe('buildAutoDiscoveryPlanId', () => {
  it('is the deterministic "${instance}:${plan}" key', () => {
    expect(buildAutoDiscoveryPlanId('pi_1', 'plan_basic')).toBe('pi_1:plan_basic');
  });
});

describe('planRowToCapabilities', () => {
  it('normalizes caps to sorted, de-duped pipeline/modelId strings', () => {
    expect(planRowToCapabilities(ROW)).toEqual([
      'image-to-image/nano-banana',
      'live-video-to-video/scope',
    ]);
  });

  it('drops caps missing a pipeline or model', () => {
    const row: PymthouseDiscoveryPlanRow = {
      ...ROW,
      capabilities: [
        { pipeline: '', modelId: 'x', discoveryPolicy: null },
        { pipeline: 'p', modelId: '', discoveryPolicy: null },
        { pipeline: 'p', modelId: 'm', discoveryPolicy: null },
      ],
    };
    expect(planRowToCapabilities(row)).toEqual(['p/m']);
  });
});

describe('computeProviderPlanRevision', () => {
  it('is stable for the same content (idempotent) and order-independent on caps', () => {
    const a = computeProviderPlanRevision({
      name: 'Basic',
      capabilities: ['b/y', 'a/x'],
      discoveryPolicy: { topN: 5 },
    });
    const b = computeProviderPlanRevision({
      name: 'Basic',
      capabilities: ['a/x', 'b/y'],
      discoveryPolicy: { topN: 5 },
    });
    expect(a).toBe(b);
  });

  it('changes when the spec changes', () => {
    const base = computeProviderPlanRevision({
      name: 'Basic',
      capabilities: ['a/x'],
      discoveryPolicy: null,
    });
    expect(
      computeProviderPlanRevision({ name: 'Basic', capabilities: ['a/x', 'b/y'], discoveryPolicy: null }),
    ).not.toBe(base);
    expect(
      computeProviderPlanRevision({ name: 'Pro', capabilities: ['a/x'], discoveryPolicy: null }),
    ).not.toBe(base);
    expect(
      computeProviderPlanRevision({ name: 'Basic', capabilities: ['a/x'], discoveryPolicy: { topN: 1 } }),
    ).not.toBe(base);
  });
});

describe('toAutoDiscoveryPlanFields', () => {
  it('defaults topN and nulls policy fields when no discoveryPolicy', () => {
    const fields = toAutoDiscoveryPlanFields({
      adapterType: 'pymthouse',
      name: 'Basic',
      capabilities: ['a/x'],
      discoveryPolicy: null,
    });
    expect(fields).toEqual({
      name: 'Basic',
      billingProviderSlug: 'pymthouse',
      capabilities: ['a/x'],
      topN: AUTO_DISCOVERY_DEFAULT_TOP_N,
      slaWeights: null,
      slaMinScore: null,
      sortBy: null,
      filters: null,
    });
  });

  it('flows discoveryPolicy straight through onto the DiscoveryPlan fields', () => {
    const fields = toAutoDiscoveryPlanFields({
      adapterType: 'pymthouse',
      name: 'Pro',
      capabilities: ['a/x'],
      discoveryPolicy: {
        topN: 25,
        sortBy: 'latency',
        slaMinScore: 0.8,
        slaWeights: { latency: 0.5 },
        filters: { priceMax: 100 },
      },
    });
    expect(fields.topN).toBe(25);
    expect(fields.sortBy).toBe('latency');
    expect(fields.slaMinScore).toBe(0.8);
    expect(fields.slaWeights).toEqual({ latency: 0.5 });
    expect(fields.filters).toEqual({ priceMax: 100 });
  });
});
