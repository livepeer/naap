import type { BodyTransformStrategy, BodyTransformContext } from '../types';

export const binaryTransform: BodyTransformStrategy = {
  name: 'binary',
  transform(ctx: BodyTransformContext): BodyInit | undefined {
    return ctx.consumerBodyRaw ? ctx.consumerBodyRaw : undefined;
  },
};
