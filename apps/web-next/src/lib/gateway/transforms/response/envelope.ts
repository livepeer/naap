import type { ResponseTransformStrategy, ResponseTransformContext } from '../types';
import { buildSafeResponseHeaders } from './shared';

export const envelopeResponse: ResponseTransformStrategy = {
  name: 'envelope',
  async transform(ctx: ResponseTransformContext): Promise<Response> {
    const contentType = ctx.upstreamResponse.headers.get('content-type') || 'application/json';
    const responseHeaders = buildSafeResponseHeaders(ctx, contentType);

    if (contentType.includes('application/json')) {
      try {
        const body = await ctx.upstreamResponse.text();
        let parsedBody: unknown;
        try {
          parsedBody = JSON.parse(body);
        } catch {
          parsedBody = body;
        }

        const envelope: Record<string, unknown> = {
          success: ctx.upstreamResponse.ok,
          data: parsedBody,
          meta: {
            connector: ctx.connectorSlug,
            upstreamStatus: ctx.upstreamResponse.status,
            latencyMs: ctx.upstreamLatencyMs,
            cached: ctx.cached,
            timestamp: new Date().toISOString(),
          },
        };

        if (!ctx.upstreamResponse.ok && ctx.errorMapping) {
          const mappedMessage = ctx.errorMapping[String(ctx.upstreamResponse.status)];
          if (mappedMessage) {
            envelope.error = {
              code: `UPSTREAM_${ctx.upstreamResponse.status}`,
              message: mappedMessage,
            };
          }
        }

        responseHeaders.set('Content-Type', 'application/json');
        return new Response(JSON.stringify(envelope), {
          status: ctx.upstreamResponse.status,
          headers: responseHeaders,
        });
      } catch {
        // Fall through to raw passthrough on parse failure
      }
    }

    const body = await ctx.upstreamResponse.arrayBuffer();
    return new Response(body, {
      status: ctx.upstreamResponse.status,
      headers: responseHeaders,
    });
  },
};
