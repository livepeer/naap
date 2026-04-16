import { describe, it, expect } from 'vitest';
import { buildSchema } from 'graphql';
import { SCHEMA_SDL } from '../graphql/schema.js';

describe('GraphQL schema', () => {
  it('compiles without errors', () => {
    expect(() => buildSchema(SCHEMA_SDL)).not.toThrow();
  });

  it('has Query type with required fields', () => {
    const schema = buildSchema(SCHEMA_SDL);
    const queryType = schema.getQueryType();
    expect(queryType).toBeTruthy();

    const fields = queryType!.getFields();
    expect(fields.capabilities).toBeTruthy();
    expect(fields.capability).toBeTruthy();
    expect(fields.categories).toBeTruthy();
    expect(fields.stats).toBeTruthy();
  });

  it('EnrichedCapability has all expected fields', () => {
    const schema = buildSchema(SCHEMA_SDL);
    const capType = schema.getType('EnrichedCapability') as any;
    expect(capType).toBeTruthy();

    const fields = capType.getFields();
    const expectedFields = [
      'id', 'name', 'category', 'source', 'gpuCount',
      'totalCapacity', 'orchestratorCount', 'avgLatencyMs',
      'meanPriceUsd', 'sdkSnippet', 'models', 'lastUpdated',
    ];
    for (const f of expectedFields) {
      expect(fields[f]).toBeTruthy();
    }
  });
});
