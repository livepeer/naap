import type { BodyTransformStrategy, BodyTransformContext } from '../types';
import { interpolateTemplate } from '../types';

export const templateTransform: BodyTransformStrategy = {
  name: 'template',
  transform(ctx: BodyTransformContext): BodyInit | undefined {
    if (!ctx.upstreamStaticBody || !ctx.consumerBody) {
      return ctx.consumerBody || undefined;
    }
    try {
      const body = JSON.parse(ctx.consumerBody);
      return interpolateTemplate(ctx.upstreamStaticBody, body);
    } catch (err) {
      console.warn('[gateway] template transform: failed to parse consumer body as JSON, passing through:', err);
      return ctx.consumerBody;
    }
  },
};
