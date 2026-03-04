import type { BodyTransformStrategy, BodyTransformContext } from '../types';

const MAX_DEPTH = 10;

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
      return encodeFormData(data, undefined, 0);
    } catch (err) {
      console.warn('[gateway] form-encode: failed to parse consumer body as JSON, passing through:', err);
      return ctx.consumerBody;
    }
  },
};

function encodeFormData(
  obj: Record<string, unknown>,
  prefix: string | undefined,
  depth: number,
): string {
  if (depth > MAX_DEPTH) {
    return '';
  }

  const parts: string[] = [];

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}[${key}]` : key;

    if (value === null || value === undefined) {
      continue;
    } else if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const itemKey = `${fullKey}[${i}]`;
        if (typeof value[i] === 'object' && value[i] !== null) {
          const nested = encodeFormData(value[i] as Record<string, unknown>, itemKey, depth + 1);
          if (nested) parts.push(nested);
        } else {
          parts.push(`${encodeURIComponent(itemKey)}=${encodeURIComponent(String(value[i] ?? ''))}`);
        }
      }
    } else if (typeof value === 'object') {
      const nested = encodeFormData(value as Record<string, unknown>, fullKey, depth + 1);
      if (nested) parts.push(nested);
    } else {
      parts.push(`${encodeURIComponent(fullKey)}=${encodeURIComponent(String(value))}`);
    }
  }

  return parts.join('&');
}
