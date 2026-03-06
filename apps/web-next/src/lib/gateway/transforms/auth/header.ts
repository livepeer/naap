import type { AuthStrategy, AuthContext } from '../types';
import { interpolateSecrets } from '../types';

export const headerAuth: AuthStrategy = {
  name: 'header',
  inject(ctx: AuthContext): void {
    const headerEntries = (ctx.authConfig.headers as Record<string, string>) || {};
    let anyMissing = false;
    for (const [key, valueRef] of Object.entries(headerEntries)) {
      const resolved = interpolateSecrets(valueRef, ctx.secrets);
      if (resolved === valueRef && valueRef.includes('{{secrets.')) {
        console.warn(`[gateway] auth: secret ref "${valueRef}" not resolved for connector "${ctx.connectorSlug}"`);
        anyMissing = true;
      }
      ctx.headers.set(key, resolved);
    }
    if (anyMissing) {
      ctx.headers.set('X-Gateway-Warning', 'missing-auth-secret');
    }
  },
};
