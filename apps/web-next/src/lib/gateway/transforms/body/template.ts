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
    } catch {
      return ctx.consumerBody;
    }
  },
};
