import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerSource,
  getSources,
  getEnabledSources,
  getCoreSources,
  getEnrichmentSources,
} from '../sources/registry.js';
import type { CapabilityDataSource, SourceContext, SourceResult } from '../sources/interface.js';

function createMockSource(overrides: Partial<CapabilityDataSource> = {}): CapabilityDataSource {
  return {
    id: 'test-source',
    name: 'Test Source',
    type: 'core',
    fetch: async (_ctx: SourceContext): Promise<SourceResult> => ({
      capabilities: [
        { id: 'cap-1', fields: { name: 'Cap 1', category: 't2i' } },
      ],
      status: 'success',
      durationMs: 100,
    }),
    ...overrides,
  };
}

describe('sources/registry', () => {
  // The registry is a singleton module, so sources accumulate across tests.
  // We test additive behavior.

  it('registerSource adds a source', () => {
    const before = getSources().length;
    registerSource(createMockSource({ id: `test-${Date.now()}` }));
    expect(getSources().length).toBe(before + 1);
  });

  it('getEnabledSources filters by enabledMap', () => {
    const id = `en-${Date.now()}`;
    registerSource(createMockSource({ id }));
    const enabled = getEnabledSources({ [id]: false });
    expect(enabled.find((s) => s.id === id)).toBeUndefined();
    const enabledTrue = getEnabledSources({ [id]: true });
    expect(enabledTrue.find((s) => s.id === id)).toBeDefined();
  });

  it('getCoreSources returns only core type', () => {
    const coreId = `core-${Date.now()}`;
    const enrichId = `enrich-${Date.now()}`;
    registerSource(createMockSource({ id: coreId, type: 'core' }));
    registerSource(createMockSource({ id: enrichId, type: 'enrichment' }));
    const core = getCoreSources({});
    expect(core.find((s) => s.id === coreId)).toBeDefined();
    expect(core.find((s) => s.id === enrichId)).toBeUndefined();
  });

  it('getEnrichmentSources returns only enrichment type', () => {
    const enrichId = `enrich2-${Date.now()}`;
    registerSource(createMockSource({ id: enrichId, type: 'enrichment' }));
    const enrichment = getEnrichmentSources({});
    expect(enrichment.find((s) => s.id === enrichId)).toBeDefined();
  });
});

describe('CapabilityDataSource interface', () => {
  it('fetch returns SourceResult with capabilities', async () => {
    const source = createMockSource();
    const ctx: SourceContext = { authToken: 'test', requestUrl: 'http://localhost' };
    const result = await source.fetch(ctx);

    expect(result.status).toBe('success');
    expect(result.capabilities).toHaveLength(1);
    expect(result.capabilities[0].id).toBe('cap-1');
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('handles error results', async () => {
    const failSource = createMockSource({
      id: 'fail-source',
      fetch: async () => ({
        capabilities: [],
        status: 'error',
        durationMs: 50,
        errorMessage: 'Connection timeout',
      }),
    });

    const ctx: SourceContext = { authToken: 'test', requestUrl: 'http://localhost' };
    const result = await failSource.fetch(ctx);

    expect(result.status).toBe('error');
    expect(result.capabilities).toHaveLength(0);
    expect(result.errorMessage).toBe('Connection timeout');
  });
});
