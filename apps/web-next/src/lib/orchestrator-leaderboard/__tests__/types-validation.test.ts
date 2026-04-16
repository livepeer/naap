import { describe, it, expect } from 'vitest';
import { CreatePlanSchema, UpdatePlanSchema } from '../types';

describe('CreatePlanSchema', () => {
  const validInput = {
    billingPlanId: 'bp-123',
    name: 'My Plan',
    capabilities: ['image-to-image'],
    topN: 10,
  };

  it('accepts a valid minimal input', () => {
    const result = CreatePlanSchema.safeParse(validInput);
    expect(result.success).toBe(true);
  });

  it('accepts full input with all optional fields', () => {
    const result = CreatePlanSchema.safeParse({
      ...validInput,
      slaWeights: { latency: 0.4, swapRate: 0.3, price: 0.3 },
      slaMinScore: 0.5,
      sortBy: 'latency',
      filters: { gpuRamGbMin: 8, priceMax: 500 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects missing billingPlanId', () => {
    const { billingPlanId, ...rest } = validInput;
    const result = CreatePlanSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects empty capabilities array', () => {
    const result = CreatePlanSchema.safeParse({ ...validInput, capabilities: [] });
    expect(result.success).toBe(false);
  });

  it('rejects invalid capability pattern', () => {
    const result = CreatePlanSchema.safeParse({
      ...validInput,
      capabilities: ['valid', 'has space'],
    });
    expect(result.success).toBe(false);
  });

  it('rejects topN > 1000', () => {
    const result = CreatePlanSchema.safeParse({ ...validInput, topN: 1001 });
    expect(result.success).toBe(false);
  });

  it('rejects invalid sortBy', () => {
    const result = CreatePlanSchema.safeParse({ ...validInput, sortBy: 'invalid' });
    expect(result.success).toBe(false);
  });

  it('rejects slaMinScore > 1', () => {
    const result = CreatePlanSchema.safeParse({ ...validInput, slaMinScore: 1.5 });
    expect(result.success).toBe(false);
  });

  it('rejects slaMinScore < 0', () => {
    const result = CreatePlanSchema.safeParse({ ...validInput, slaMinScore: -0.1 });
    expect(result.success).toBe(false);
  });

  it('rejects unknown filter keys (strict)', () => {
    const result = CreatePlanSchema.safeParse({
      ...validInput,
      filters: { unknownField: 42 },
    });
    expect(result.success).toBe(false);
  });

  it('defaults topN to 10', () => {
    const { topN, ...rest } = validInput;
    const result = CreatePlanSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.topN).toBe(10);
    }
  });
});

describe('UpdatePlanSchema', () => {
  it('accepts partial update (name only)', () => {
    const result = UpdatePlanSchema.safeParse({ name: 'New Name' });
    expect(result.success).toBe(true);
  });

  it('accepts empty object (no fields to update)', () => {
    const result = UpdatePlanSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('strips billingPlanId from output (not updatable)', () => {
    const result = UpdatePlanSchema.safeParse({ billingPlanId: 'new-id', name: 'ok' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect('billingPlanId' in result.data).toBe(false);
    }
  });

  it('validates capability pattern on partial update', () => {
    const result = UpdatePlanSchema.safeParse({
      capabilities: ['valid-cap', 'has spaces'],
    });
    expect(result.success).toBe(false);
  });
});
