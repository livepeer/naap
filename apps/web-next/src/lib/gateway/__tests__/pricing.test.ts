import { describe, it, expect } from 'vitest';
import { formatPricingResponse, calculateCost } from '../pricing';

function makePricing(overrides: Record<string, unknown> = {}) {
  return {
    costPerUnit: 0.03,
    unit: '1k-tokens',
    currency: 'USD',
    billingModel: 'per-unit',
    freeQuota: null,
    volumeTiers: '[]',
    featurePricing: '[]',
    upstreamCostPerUnit: null,
    upstreamUnit: null,
    upstreamNotes: null,
    ...overrides,
  };
}

const connector = { slug: 'openai', displayName: 'OpenAI API' };

describe('formatPricingResponse', () => {
  it('returns free pricing when no ConnectorPricing', () => {
    const result = formatPricingResponse(connector, null);
    expect(result.pricing.billingModel).toBe('free');
    expect(result.pricing.costPerUnit).toBe(0);
  });

  it('formats all pricing fields', () => {
    const result = formatPricingResponse(connector, makePricing({ freeQuota: 100 }));
    expect(result.connector).toBe('openai');
    expect(result.displayName).toBe('OpenAI API');
    expect(result.pricing.costPerUnit).toBe(0.03);
    expect(result.pricing.unit).toBe('1k-tokens');
    expect(result.pricing.currency).toBe('USD');
    expect(result.pricing.freeQuota).toBe(100);
  });

  it('includes upstream cost when present', () => {
    const result = formatPricingResponse(connector, makePricing({
      upstreamCostPerUnit: 0.025,
      upstreamUnit: '1k-tokens',
      upstreamNotes: 'OpenAI pricing',
    }));
    expect(result.pricing.upstreamCost).toEqual({
      costPerUnit: 0.025,
      unit: '1k-tokens',
      notes: 'OpenAI pricing',
    });
  });

  it('omits upstream cost when null', () => {
    const result = formatPricingResponse(connector, makePricing());
    expect(result.pricing.upstreamCost).toBeUndefined();
  });
});

describe('calculateCost', () => {
  it('calculates base cost without tiers', () => {
    const result = calculateCost(makePricing(), 1000);
    expect(result.estimatedCost).toBe(30);
    expect(result.unit).toBe('1k-tokens');
  });

  it('applies correct volume tier', () => {
    const result = calculateCost(
      makePricing({
        volumeTiers: [
          { minUnits: 1000, costPerUnit: 0.025 },
          { minUnits: 10000, costPerUnit: 0.02 },
        ],
      }),
      5000
    );
    expect(result.estimatedCost).toBe(125);
    expect(result.appliedTier).toEqual({ minUnits: 1000, costPerUnit: 0.025 });
  });

  it('uses feature-specific pricing when feature param provided', () => {
    const result = calculateCost(
      makePricing({
        featurePricing: [
          { feature: 'embeddings', costPerUnit: 0.0001, unit: '1k-tokens' },
        ],
      }),
      10000,
      'embeddings'
    );
    expect(result.estimatedCost).toBe(1);
    expect(result.feature).toBe('embeddings');
  });

  it('falls back to base cost when feature not found', () => {
    const result = calculateCost(makePricing(), 1000, 'unknown-feature');
    expect(result.estimatedCost).toBe(30);
  });

  it('feature pricing takes precedence over volume tiers', () => {
    const result = calculateCost(
      makePricing({
        featurePricing: [
          { feature: 'embeddings', costPerUnit: 0.0001, unit: '1k-tokens' },
        ],
        volumeTiers: [
          { minUnits: 100, costPerUnit: 0.025 },
        ],
      }),
      10000,
      'embeddings'
    );
    expect(result.estimatedCost).toBe(1);
    expect(result.feature).toBe('embeddings');
    expect(result.appliedTier).toBeUndefined();
  });

  it('passes connector slug through when provided', () => {
    const result = calculateCost(makePricing(), 100, undefined, 'my-connector');
    expect(result.connector).toBe('my-connector');
  });
});
