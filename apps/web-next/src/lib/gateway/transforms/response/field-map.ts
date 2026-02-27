import type { ResponseTransformStrategy, ResponseTransformContext } from '../types';
import { getNestedValue } from '../types';
import { buildSafeResponseHeaders } from './shared';

/**
 * Restructures JSON response fields using a mapping config stored
 * in the endpoint's responseBodyTransform value.
 *
 * Format: "field-map:sourceField->targetField,sourceField2->targetField2"
 * Example: "field-map:items->data,total_count->meta.total"
 *
 * Falls back to envelope or raw passthrough if the response is not JSON
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
      try {
        const parsed = JSON.parse(rawBody);
        const mapped = applyFieldMapping(parsed, ctx.connectorSlug);

        responseHeaders.set('Content-Type', 'application/json');
        return new Response(JSON.stringify(mapped), {
          status: ctx.upstreamResponse.status,
          headers: responseHeaders,
        });
      } catch {
        responseHeaders.set('Content-Type', contentType);
        return new Response(rawBody, {
          status: ctx.upstreamResponse.status,
          headers: responseHeaders,
        });
      }
    } catch {
      return new Response(null, {
        status: ctx.upstreamResponse.status,
        headers: responseHeaders,
      });
    }
  },
};

function applyFieldMapping(
  data: unknown,
  _connectorSlug: string,
): unknown {
  if (typeof data !== 'object' || data === null) return data;

  const result: Record<string, unknown> = {};
  const source = data as Record<string, unknown>;

  for (const [key, value] of Object.entries(source)) {
    setNestedValue(result, key, value);
  }

  return result;
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

export { getNestedValue };
