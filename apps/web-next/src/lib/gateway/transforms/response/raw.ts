import type { ResponseTransformStrategy, ResponseTransformContext } from '../types';
import { buildSafeResponseHeaders } from './shared';

export const rawResponse: ResponseTransformStrategy = {
  name: 'raw',
  async transform(ctx: ResponseTransformContext): Promise<Response> {
    const contentType = ctx.upstreamResponse.headers.get('content-type') || 'application/json';
    const responseHeaders = buildSafeResponseHeaders(ctx, contentType);

    const body = await ctx.upstreamResponse.arrayBuffer();
    return new Response(body, {
      status: ctx.upstreamResponse.status,
      headers: responseHeaders,
    });
  },
};
