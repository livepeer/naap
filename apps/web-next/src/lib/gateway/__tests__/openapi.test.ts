/**
 * Tests for Service Gateway — OpenAPI Spec Generator
 *
 * Verifies spec structure, endpoint mapping, path param conversion,
 * schema flow, and YAML output.
 */

import { describe, it, expect } from 'vitest';
import { generateOpenApiSpec, jsonToYaml } from '../openapi';

function makeConnector(overrides?: Record<string, unknown>) {
  return {
    slug: 'test-api',
    displayName: 'Test API',
    description: 'A test connector',
    version: 1,
    authType: 'bearer',
    upstreamBaseUrl: 'https://upstream.example.com',
    endpoints: [],
    ...overrides,
  };
}

function makeEndpoint(overrides?: Record<string, unknown>) {
  return {
    name: 'List Items',
    method: 'GET',
    path: '/items',
    upstreamContentType: 'application/json',
    requiredHeaders: [],
    ...overrides,
  };
}

describe('generateOpenApiSpec', () => {
  it('produces a valid OpenAPI 3.0.3 structure', () => {
    const spec = generateOpenApiSpec(makeConnector(), 'https://app.naap.live');
    expect(spec.openapi).toBe('3.0.3');
    expect(spec.info.title).toBe('Test API');
    expect(spec.info.version).toBe('v1');
    expect(spec.servers[0].url).toBe('https://app.naap.live/api/v1/gw/test-api');
    expect(spec.components.securitySchemes).toBeDefined();
    expect(spec.components.schemas.GatewayError).toBeDefined();
  });

  it('maps all endpoints into paths', () => {
    const connector = makeConnector({
      endpoints: [
        makeEndpoint({ name: 'List Items', method: 'GET', path: '/items' }),
        makeEndpoint({ name: 'Create Item', method: 'POST', path: '/items' }),
        makeEndpoint({ name: 'Get Item', method: 'GET', path: '/items/:id' }),
      ],
    });
    const spec = generateOpenApiSpec(connector, 'https://app.naap.live');

    expect(Object.keys(spec.paths)).toHaveLength(2);
    expect(spec.paths['/items']).toBeDefined();
    expect(spec.paths['/items/{id}']).toBeDefined();
    expect(spec.paths['/items']['get']).toBeDefined();
    expect(spec.paths['/items']['post']).toBeDefined();
    expect(spec.paths['/items/{id}']['get']).toBeDefined();
  });

  it('converts :param to {param} in paths', () => {
    const connector = makeConnector({
      endpoints: [
        makeEndpoint({ method: 'GET', path: '/users/:userId/posts/:postId' }),
      ],
    });
    const spec = generateOpenApiSpec(connector, 'https://app.naap.live');
    expect(spec.paths['/users/{userId}/posts/{postId}']).toBeDefined();

    const op = spec.paths['/users/{userId}/posts/{postId}']['get'];
    const pathParams = (op.parameters || []).filter((p) => p.in === 'path');
    expect(pathParams).toHaveLength(2);
    expect(pathParams[0].name).toBe('userId');
    expect(pathParams[1].name).toBe('postId');
  });

  it('includes required headers as parameters', () => {
    const connector = makeConnector({
      endpoints: [
        makeEndpoint({ requiredHeaders: ['X-Api-Version', 'X-Tenant-Id'] }),
      ],
    });
    const spec = generateOpenApiSpec(connector, 'https://app.naap.live');
    const op = Object.values(spec.paths)[0]['get'];
    const headerParams = (op.parameters || []).filter((p) => p.in === 'header');
    expect(headerParams).toHaveLength(2);
    expect(headerParams[0].name).toBe('X-Api-Version');
    expect(headerParams[0].required).toBe(true);
  });

  it('includes bodySchema in requestBody for POST endpoints', () => {
    const schema = {
      type: 'object',
      required: ['model', 'messages'],
      properties: {
        model: { type: 'string' },
        messages: { type: 'array' },
      },
    };
    const connector = makeConnector({
      endpoints: [
        makeEndpoint({ method: 'POST', path: '/chat', bodySchema: schema }),
      ],
    });
    const spec = generateOpenApiSpec(connector, 'https://app.naap.live');
    const op = spec.paths['/chat']['post'];
    expect(op.requestBody).toBeDefined();
    const content = op.requestBody!.content['application/json'];
    expect(content.schema).toEqual(schema);
  });

  it('does NOT include requestBody for GET endpoints', () => {
    const connector = makeConnector({
      endpoints: [makeEndpoint({ method: 'GET', path: '/items' })],
    });
    const spec = generateOpenApiSpec(connector, 'https://app.naap.live');
    const op = spec.paths['/items']['get'];
    expect(op.requestBody).toBeUndefined();
  });

  it('includes standard error responses on every operation', () => {
    const connector = makeConnector({
      endpoints: [makeEndpoint()],
    });
    const spec = generateOpenApiSpec(connector, 'https://app.naap.live');
    const op = Object.values(spec.paths)[0]['get'];
    expect(op.responses['400']).toBeDefined();
    expect(op.responses['401']).toBeDefined();
    expect(op.responses['429']).toBeDefined();
    expect(op.responses['502']).toBeDefined();
  });

  it('sets x-cache-ttl extension when cacheTtl is configured', () => {
    const connector = makeConnector({
      endpoints: [makeEndpoint({ cacheTtl: 300 })],
    });
    const spec = generateOpenApiSpec(connector, 'https://app.naap.live');
    const op = Object.values(spec.paths)[0]['get'];
    expect(op['x-cache-ttl']).toBe(300);
  });

  it('handles empty endpoints gracefully', () => {
    const spec = generateOpenApiSpec(makeConnector({ endpoints: [] }), 'https://app.naap.live');
    expect(spec.paths).toEqual({});
    expect(spec.openapi).toBe('3.0.3');
  });

  it('strips trailing slash from baseUrl', () => {
    const spec = generateOpenApiSpec(makeConnector(), 'https://app.naap.live/');
    expect(spec.servers[0].url).toBe('https://app.naap.live/api/v1/gw/test-api');
  });
});

describe('jsonToYaml', () => {
  it('serializes simple objects', () => {
    const yaml = jsonToYaml({ name: 'test', version: 1 });
    expect(yaml).toContain('name: test');
    expect(yaml).toContain('version: 1');
  });

  it('serializes nested objects', () => {
    const yaml = jsonToYaml({ info: { title: 'API', version: 'v1' } });
    expect(yaml).toContain('info:');
    expect(yaml).toContain('title: API');
  });

  it('serializes arrays', () => {
    const yaml = jsonToYaml({ tags: ['a', 'b', 'c'] });
    expect(yaml).toContain('tags:');
    expect(yaml).toContain('- a');
    expect(yaml).toContain('- b');
  });

  it('handles null and boolean values', () => {
    const yaml = jsonToYaml({ a: null, b: true, c: false });
    expect(yaml).toContain('a: null');
    expect(yaml).toContain('b: true');
    expect(yaml).toContain('c: false');
  });

  it('quotes strings with special characters', () => {
    const yaml = jsonToYaml({ url: 'https://example.com:8080/path' });
    expect(yaml).toContain('"https://example.com:8080/path"');
  });
});
