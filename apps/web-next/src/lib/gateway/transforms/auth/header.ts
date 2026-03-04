import type { AuthStrategy, AuthContext } from '../types';
import { interpolateSecrets } from '../types';

export const headerAuth: AuthStrategy = {
  name: 'header',
  inject(ctx: AuthContext): void {
    const rawHeaders = ctx.authConfig.headers;
    if (!rawHeaders || typeof rawHeaders !== 'object') return;
    for (const [key, valueRef] of Object.entries(rawHeaders as Record<string, unknown>)) {
      const template = typeof valueRef === 'string' ? valueRef : '';
      ctx.headers.set(key, interpolateSecrets(template, ctx.secrets));
    }
  },
};
