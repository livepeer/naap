import type { BodyTransformStrategy, BodyTransformContext } from '../types';
import { getNestedValue } from '../types';

export const extractTransform: BodyTransformStrategy = {
  name: 'extract',
  transform(ctx: BodyTransformContext): BodyInit | undefined {
    if (!ctx.consumerBody) {
      return ctx.consumerBody || undefined;
    }
    const fieldPath = ctx.bodyTransform.slice('extract:'.length);
    try {
      const body = JSON.parse(ctx.consumerBody);
      const extracted = getNestedValue(body, fieldPath);
      return extracted !== undefined ? JSON.stringify(extracted) : ctx.consumerBody;
    } catch {
      return ctx.consumerBody;
    }
  },
};
