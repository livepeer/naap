import { describe, it, expect } from 'vitest';
import {
  catalogToMcpTools,
  catalogToOpenAiFunctions,
  mcpToolNameToRoute,
  handleMcpRequest,
} from '../mcp-adapter';
import type { ToolDescriptor } from '../catalog';

function makeCatalog(): ToolDescriptor[] {
  return [
    {
      name: 'openai',
      displayName: 'OpenAI API',
      description: 'OpenAI LLM APIs',
      category: 'ai',
      tags: ['openai'],
      status: 'published',
      endpoints: [
        {
          name: 'chat-completions',
          description: 'Create a chat completion',
          method: 'POST',
          path: '/chat/completions',
          inputSchema: { type: 'object', properties: { model: { type: 'string' } }, required: ['model'] },
          streaming: false,
        },
      ],
      pricing: null,
      performance: null,
      rankings: [],
      auth: { type: 'bearer', headerName: 'Authorization', prefix: 'Bearer' },
      baseUrl: '/api/v1/gw/openai',
      healthStatus: 'up',
    },
  ];
}

describe('catalogToMcpTools', () => {
  it('converts each endpoint to an MCP tool', () => {
    const result = catalogToMcpTools(makeCatalog());
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('openai__chat_completions');
  });

  it('uses connector__endpoint naming convention', () => {
    const result = catalogToMcpTools(makeCatalog());
    expect(result[0].name).toContain('__');
  });

  it('replaces hyphens with underscores in names', () => {
    const result = catalogToMcpTools(makeCatalog());
    expect(result[0].name).toBe('openai__chat_completions');
  });

  it('includes inputSchema from endpoint', () => {
    const result = catalogToMcpTools(makeCatalog());
    expect(result[0].inputSchema).toEqual({
      type: 'object',
      properties: { model: { type: 'string' } },
      required: ['model'],
    });
  });
});

describe('catalogToOpenAiFunctions', () => {
  it('converts each endpoint to OpenAI function format', () => {
    const result = catalogToOpenAiFunctions(makeCatalog());
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe('function');
    expect(result[0].function.name).toBe('openai__chat_completions');
  });

  it('includes parameters from inputSchema', () => {
    const result = catalogToOpenAiFunctions(makeCatalog());
    expect(result[0].function.parameters).toEqual({
      type: 'object',
      properties: { model: { type: 'string' } },
      required: ['model'],
    });
  });

  it('embeds invocation URL in description', () => {
    const result = catalogToOpenAiFunctions(makeCatalog());
    expect(result[0].function.description).toContain('POST /api/v1/gw/openai/chat/completions');
  });
});

describe('mcpToolNameToRoute', () => {
  it('parses connector__endpoint correctly', () => {
    const result = mcpToolNameToRoute('openai__chat_completions');
    expect(result.connector).toBe('openai');
    expect(result.endpointPath).toBe('chat-completions');
  });

  it('converts underscores back to hyphens in endpoint name', () => {
    const result = mcpToolNameToRoute('my_api__my_endpoint_name');
    expect(result.endpointPath).toBe('my-endpoint-name');
  });

  it('handles connectors without endpoints', () => {
    const result = mcpToolNameToRoute('singlename');
    expect(result.connector).toBe('singlename');
    expect(result.endpointPath).toBe('/');
  });
});

describe('handleMcpRequest', () => {
  it('returns tools list for tools/list method', async () => {
    const result = await handleMcpRequest(
      { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} },
      makeCatalog(),
    );
    expect(result.result).toBeDefined();
    const tools = (result.result as { tools: unknown[] }).tools;
    expect(tools).toHaveLength(1);
  });

  it('returns error for unknown method', async () => {
    const result = await handleMcpRequest(
      { jsonrpc: '2.0', id: 1, method: 'unknown/method', params: {} },
      makeCatalog(),
    );
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe(-32601);
  });

  it('returns error for malformed JSON-RPC', async () => {
    const result = await handleMcpRequest(
      { jsonrpc: '1.0' as '2.0', id: 1, method: 'tools/list' },
      makeCatalog(),
    );
    expect(result.error).toBeDefined();
    expect(result.error!.code).toBe(-32600);
  });
});
