import type { ResponseTransformStrategy, ResponseTransformContext } from '../types';
import { buildSafeResponseHeaders } from './shared';

/**
 * Restructures JSON response fields using a mapping config stored
 * in the endpoint's responseBodyTransform value.
 *
 * Format: "field-map:sourceField->targetField,sourceField2->targetField2"
 * Example: "field-map:items->data,total_count->meta.total"
 *
 * Falls back to raw passthrough if the response is not JSON
 * or if the mapping fails.
 */
export const fieldMapResponse: ResponseTransformStrategy = {
  name: 'field-map',
  async transform(ctx: ResponseTransformContext): Promise<Response> {
    const contentType = ctx.upstreamResponse.headers.get('content-type') || 'application/json';
    const responseHeaders = buildSafeResponseHeaders(ctx, contentType);

    if (!contentType.includes('application/json')) {
      const body = await ctx.upstreamResponse.arrayBuffer();
      return new Response(body, {
        status: ctx.upstreamResponse.status,
        headers: responseHeaders,
      });
    }

    try {
      const rawBody = await ctx.upstreamResponse.text();
      const parsed = JSON.parse(rawBody);
      const mappings = parseMappingConfig(ctx.responseBodyTransform);
      const mapped = applyFieldMapping(parsed, mappings);

      responseHeaders.set('Content-Type', 'application/json');
      return new Response(JSON.stringify(mapped), {
        status: ctx.upstreamResponse.status,
        headers: responseHeaders,
      });
    } catch (err) {
      console.warn('[gateway] field-map transform failed, falling back to raw:', err);
      responseHeaders.set('Content-Type', contentType);
      const body = await ctx.upstreamResponse.arrayBuffer();
      return new Response(body, {
        status: ctx.upstreamResponse.status,
        headers: responseHeaders,
      });
    }
  },
};

interface FieldMapping {
  source: string;
  target: string;
}

/**
 * Parse "field-map:source->target,source2->target2" into structured mappings.
 * Returns an empty array if the format is invalid (passthrough behavior).
 */
function parseMappingConfig(config: string): FieldMapping[] {
  const prefix = 'field-map:';
  if (!config.startsWith(prefix)) return [];

  const spec = config.slice(prefix.length).trim();
  if (!spec) return [];

  return spec.split(',').reduce<FieldMapping[]>((acc, pair) => {
    const parts = pair.trim().split('->');
    if (parts.length === 2 && parts[0].trim() && parts[1].trim()) {
      acc.push({ source: parts[0].trim(), target: parts[1].trim() });
    }
    return acc;
  }, []);
}

function getNestedValue(obj: unknown, path: string): unknown {
  const parts = path.split('.');
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== 'object') {
      return undefined;
    }
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function setNestedValue(
  obj: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const parts = path.split('.');
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (!(parts[i] in current) || typeof current[parts[i]] !== 'object') {
      current[parts[i]] = {};
    }
    current = current[parts[i]] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

function applyFieldMapping(
  data: unknown,
  mappings: FieldMapping[],
): unknown {
  if (typeof data !== 'object' || data === null) return data;

  if (mappings.length === 0) {
    return data;
  }

  const result: Record<string, unknown> = {};
  for (const { source, target } of mappings) {
    const value = getNestedValue(data, source);
    if (value !== undefined) {
      setNestedValue(result, target, value);
    }
  }
  return result;
}
