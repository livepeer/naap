import { describe, it, expect, vi } from 'vitest';

vi.mock('@/lib/db', () => ({
  prisma: {},
}));

import { buildToolDescriptor } from '../catalog';

function makeConnector(overrides: Record<string, unknown> = {}) {
  return {
    slug: 'openai',
    displayName: 'OpenAI API',
    description: 'OpenAI LLM APIs',
    agentDescription: null,
    agentNotFor: null,
    inputSchema: null,
    outputSchema: null,
    category: 'ai',
    tags: ['openai', 'llm'],
    status: 'published',
    authType: 'bearer',
    streamingEnabled: false,
    endpoints: [
      {
        name: 'chat-completions',
        description: 'Create a chat completion',
        method: 'POST',
        path: '/chat/completions',
        bodySchema: { type: 'object', properties: { model: { type: 'string' } } },
        requiredHeaders: [],
        rateLimit: 30,
        timeout: 120000,
        examples: null,
      },
    ],
    pricing: null,
    healthChecks: [],
    metrics: [],
    rankings: [],
    ...overrides,
  };
}

describe('buildToolDescriptor', () => {
  it('maps connector fields correctly', () => {
    const result = buildToolDescriptor(makeConnector(), '/api/v1/gw');
    expect(result.name).toBe('openai');
    expect(result.displayName).toBe('OpenAI API');
    expect(result.description).toBe('OpenAI LLM APIs');
    expect(result.category).toBe('ai');
    expect(result.tags).toEqual(['openai', 'llm']);
    expect(result.status).toBe('published');
  });

  it('sets streaming flag from connector.streamingEnabled', () => {
    const result = buildToolDescriptor(makeConnector({ streamingEnabled: true }), '/api/v1/gw');
    expect(result.endpoints[0].streaming).toBe(true);
  });

  it('includes auth info based on connector.authType', () => {
    const result = buildToolDescriptor(makeConnector(), '/api/v1/gw');
    expect(result.auth.type).toBe('bearer');
    expect(result.auth.headerName).toBe('Authorization');
  });

  it('constructs correct baseUrl', () => {
    const result = buildToolDescriptor(makeConnector(), '/api/v1/gw');
    expect(result.baseUrl).toBe('/api/v1/gw/openai');
  });

  it('includes pricing data when ConnectorPricing exists', () => {
    const pricing = {
      costPerUnit: 0.03,
      unit: '1k-tokens',
      currency: 'USD',
      billingModel: 'per-unit',
      freeQuota: 100,
      volumeTiers: [],
      featurePricing: [],
      upstreamCostPerUnit: null,
      upstreamUnit: null,
      upstreamNotes: null,
    };
    const result = buildToolDescriptor(makeConnector({ pricing }), '/api/v1/gw');
    expect(result.pricing).not.toBeNull();
    expect(result.pricing!.costPerUnit).toBe(0.03);
    expect(result.pricing!.unit).toBe('1k-tokens');
    expect(result.pricing!.freeQuota).toBe(100);
  });

  it('returns null pricing when no ConnectorPricing', () => {
    const result = buildToolDescriptor(makeConnector(), '/api/v1/gw');
    expect(result.pricing).toBeNull();
  });

  it('includes health status from latest GatewayHealthCheck', () => {
    const result = buildToolDescriptor(
      makeConnector({ healthChecks: [{ status: 'up' }] }),
      '/api/v1/gw'
    );
    expect(result.healthStatus).toBe('up');
  });

  it('returns unknown health when no health checks', () => {
    const result = buildToolDescriptor(makeConnector(), '/api/v1/gw');
    expect(result.healthStatus).toBe('unknown');
  });

  it('includes examples from ConnectorEndpoint.examples', () => {
    const ep = {
      ...makeConnector().endpoints[0],
      examples: [{ description: 'Hello', input: { model: 'gpt-4o' }, output: { choices: [] } }],
    };
    const result = buildToolDescriptor(makeConnector({ endpoints: [ep] }), '/api/v1/gw');
    expect(result.endpoints[0].examples).toHaveLength(1);
    expect(result.endpoints[0].examples![0].description).toBe('Hello');
  });

  it('falls back bodySchema to inputSchema when inputSchema not set', () => {
    const result = buildToolDescriptor(makeConnector(), '/api/v1/gw');
    expect(result.endpoints[0].inputSchema).toEqual({
      type: 'object',
      properties: { model: { type: 'string' } },
    });
  });

  it('includes agentDescription when set', () => {
    const result = buildToolDescriptor(
      makeConnector({ agentDescription: 'Use for text generation' }),
      '/api/v1/gw'
    );
    expect(result.agentDescription).toBe('Use for text generation');
  });

  it('returns null performance when no metrics exist', () => {
    const result = buildToolDescriptor(makeConnector(), '/api/v1/gw');
    expect(result.performance).toBeNull();
  });

  it('returns empty rankings array when none set', () => {
    const result = buildToolDescriptor(makeConnector(), '/api/v1/gw');
    expect(result.rankings).toEqual([]);
  });

  it('includes rankings from ConnectorCapabilityRanking[]', () => {
    const rankings = [{
      category: 'text-to-text',
      modelName: 'gpt-4o',
      qualityRank: 2,
      qualityScore: 95,
      speedRank: 3,
      costEfficiencyRank: 5,
      totalRanked: 25,
      benchmarkSource: 'Arena ELO',
      benchmarkScore: 1287,
      benchmarkUrl: null,
      capabilityTags: ['vision'],
      notes: null,
    }];
    const result = buildToolDescriptor(makeConnector({ rankings }), '/api/v1/gw');
    expect(result.rankings).toHaveLength(1);
    expect(result.rankings[0].qualityRank).toBe(2);
  });
});
