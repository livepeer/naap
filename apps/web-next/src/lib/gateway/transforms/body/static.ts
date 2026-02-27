import type { BodyTransformStrategy, BodyTransformContext } from '../types';

export const staticTransform: BodyTransformStrategy = {
  name: 'static',
  transform(ctx: BodyTransformContext): BodyInit | undefined {
    return ctx.upstreamStaticBody || undefined;
  },
};
