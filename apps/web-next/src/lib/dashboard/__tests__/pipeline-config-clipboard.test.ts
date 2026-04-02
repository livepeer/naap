import { describe, expect, it } from 'vitest';
import type { DashboardPipelinePricing } from '@naap/plugin-sdk';
import {
  buildPipelineModelConfigJson,
  buildPipelineModelCopyText,
  formatPipelineModelConfigJson,
  gweiPerUnitIfNominal,
  weiPerUnitString,
} from '../pipeline-config-clipboard';

describe('buildPipelineModelCopyText', () => {
  it('uses tab between pipeline and model', () => {
    expect(buildPipelineModelCopyText('live-video-to-video', 'streamdiffusion-sdxl')).toBe(
      'live-video-to-video\tstreamdiffusion-sdxl',
    );
  });
});

describe('weiPerUnitString', () => {
  it('prefers avgWeiPerUnit when set', () => {
    const p = {
      pipeline: 'x',
      unit: 'pixel',
      price: 0.001,
      avgWeiPerUnit: '  999000000001  ',
      outputPerDollar: '',
    } as DashboardPipelinePricing;
    expect(weiPerUnitString(p)).toBe('999000000001');
  });

  it('falls back to rounded price * 1e12 when avgWeiPerUnit missing', () => {
    const p: DashboardPipelinePricing = {
      pipeline: 'x',
      model: 'm',
      unit: 'pixel',
      price: 0.000_000_002_4,
      outputPerDollar: '',
    };
    expect(weiPerUnitString(p)).toBe('2400');
  });

  it('returns empty when no positive price', () => {
    expect(weiPerUnitString(undefined)).toBe('');
    expect(
      weiPerUnitString({
        pipeline: 'x',
        unit: 'pixel',
        price: 0,
        outputPerDollar: '',
      }),
    ).toBe('');
  });
});

describe('gweiPerUnitIfNominal', () => {
  it('returns undefined below 1 gwei', () => {
    expect(gweiPerUnitIfNominal('999999999')).toBeUndefined();
    expect(gweiPerUnitIfNominal('0')).toBeUndefined();
  });

  it('returns undefined at or above 1 ETH in wei', () => {
    expect(gweiPerUnitIfNominal('1000000000000000000')).toBeUndefined();
    expect(gweiPerUnitIfNominal('20000000000000000000')).toBeUndefined();
  });

  it('returns gwei in the nominal band', () => {
    expect(gweiPerUnitIfNominal('1000000000')).toBe(1);
    expect(gweiPerUnitIfNominal('1500000000')).toBe(1.5);
  });

  it('rejects non-digit strings', () => {
    expect(gweiPerUnitIfNominal('1e9')).toBeUndefined();
    expect(gweiPerUnitIfNominal('')).toBeUndefined();
  });
});

describe('buildPipelineModelConfigJson', () => {
  it('omits wei when no pricing', () => {
    const j = buildPipelineModelConfigJson({
      pipelineId: 'llm',
      modelId: 'glm-4',
      pricing: undefined,
      capacity: '—',
    });
    expect(j).toEqual({ pipeline: 'llm', model_id: 'glm-4' });
  });

  it('includes wei and gwei only when wei is in nominal gwei band', () => {
    const pricing: DashboardPipelinePricing = {
      pipeline: 'llm',
      model: 'glm-4',
      unit: 'token',
      price: 0.000_023_92,
      avgWeiPerUnit: '23920000',
      pixelsPerUnit: null,
      outputPerDollar: '',
      capacity: 3,
    };
    const smallWei = buildPipelineModelConfigJson({
      pipelineId: 'llm',
      modelId: 'glm-4',
      pricing,
      capacity: 5,
    });
    expect(smallWei.wei_per_unit).toBe('23920000');
    expect(smallWei.gwei_per_unit).toBeUndefined();

    const pricingGwei: DashboardPipelinePricing = {
      ...pricing,
      avgWeiPerUnit: '1500000000',
      price: 0.0015,
    };
    const j = buildPipelineModelConfigJson({
      pipelineId: 'llm',
      modelId: 'glm-4',
      pricing: pricingGwei,
      capacity: 5,
    });
    expect(j.wei_per_unit).toBe('1500000000');
    expect(j.gwei_per_unit).toBe(1.5);
    expect(j.capacity).toBe(5);
  });

  it('omits gwei when wei is full ETH scale', () => {
    const pricing: DashboardPipelinePricing = {
      pipeline: 'x',
      model: 'm',
      unit: 'pixel',
      price: 1,
      avgWeiPerUnit: '1000000000000000000',
      outputPerDollar: '',
    };
    const j = buildPipelineModelConfigJson({
      pipelineId: 'x',
      modelId: 'm',
      pricing,
      capacity: '—',
    });
    expect(j.wei_per_unit).toBe('1000000000000000000');
    expect(j.gwei_per_unit).toBeUndefined();
  });

  it('round-trips via formatPipelineModelConfigJson', () => {
    const j = buildPipelineModelConfigJson({
      pipelineId: 'p',
      modelId: 'm',
      pricing: {
        pipeline: 'p',
        model: 'm',
        unit: 'pixel',
        price: 0.001,
        avgWeiPerUnit: '1000000000',
        pixelsPerUnit: 99,
        outputPerDollar: '',
      },
      capacity: 2,
    });
    const s = formatPipelineModelConfigJson(j);
    expect(s).toContain('"wei_per_unit": "1000000000"');
    expect(s).toContain('"gwei_per_unit": 1');
    expect(s.endsWith('\n')).toBe(true);
  });
});
