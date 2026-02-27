import type { AuthStrategy, AuthContext } from '../types';
import { interpolateSecrets } from '../types';

export const headerAuth: AuthStrategy = {
  name: 'header',
  inject(ctx: AuthContext): void {
    const headerEntries = (ctx.authConfig.headers as Record<string, string>) || {};
    for (const [key, valueRef] of Object.entries(headerEntries)) {
      ctx.headers.set(key, interpolateSecrets(valueRef, ctx.secrets));
    }
  },
};
