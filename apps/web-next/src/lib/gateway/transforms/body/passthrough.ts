import type { BodyTransformStrategy, BodyTransformContext } from '../types';

export const passthroughTransform: BodyTransformStrategy = {
  name: 'passthrough',
  transform(ctx: BodyTransformContext): BodyInit | undefined {
    return ctx.consumerBody || undefined;
  },
};
