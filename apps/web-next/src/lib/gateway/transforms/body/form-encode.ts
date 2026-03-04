import type { BodyTransformStrategy, BodyTransformContext } from '../types';

/**
 * Converts a JSON body to application/x-www-form-urlencoded format.
 * Supports nested objects via bracket notation (e.g. key[sub]=val).
 * Used by connectors like Stripe and Twilio.
 */
export const formEncodeTransform: BodyTransformStrategy = {
  name: 'form-encode',
  transform(ctx: BodyTransformContext): BodyInit | undefined {
    if (!ctx.consumerBody) return undefined;

    try {
      const data = JSON.parse(ctx.consumerBody);
      if (typeof data !== 'object' || data === null) {
        return ctx.consumerBody;
      }
      return encodeFormData(data);
    } catch {
      return ctx.consumerBody;
    }
  },
};

function encodeFormData(
  obj: Record<string, unknown>,
  prefix?: string,
): string {
  const parts: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}[${key}]` : key;

    if (value === null || value === undefined) {
      continue;
    } else if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const itemKey = `${fullKey}[${i}]`;
        if (typeof value[i] === 'object' && value[i] !== null) {
          parts.push(encodeFormData(value[i] as Record<string, unknown>, itemKey));
        } else {
          parts.push(`${encodeURIComponent(itemKey)}=${encodeURIComponent(String(value[i]))}`);
        }
      }
    } else if (typeof value === 'object') {
      parts.push(encodeFormData(value as Record<string, unknown>, fullKey));
    } else {
      parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(value))}`);
    }
  }

  return parts.filter(Boolean).join('&');
}
