import type { AuthStrategy, AuthContext } from '../types';

export const queryAuth: AuthStrategy = {
  name: 'query',
  inject(ctx: AuthContext): void {
    const paramName = (ctx.authConfig.paramName as string) || 'key';
    const secretRef = (ctx.authConfig.secretRef as string) || 'token';
    const secretValue = ctx.secrets[secretRef];
    if (secretValue) {
      ctx.url.searchParams.set(paramName, secretValue);
    } else {
      console.warn(`[gateway] auth: secret "${secretRef}" not resolved for connector "${ctx.connectorSlug}"`);
      ctx.headers.set('X-Gateway-Warning', 'missing-auth-secret');
    }
  },
};
