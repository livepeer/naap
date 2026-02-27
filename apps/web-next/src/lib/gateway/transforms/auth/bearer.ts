import type { AuthStrategy, AuthContext } from '../types';

export const bearerAuth: AuthStrategy = {
  name: 'bearer',
  inject(ctx: AuthContext): void {
    const tokenRef = (ctx.authConfig.tokenRef as string) || 'token';
    const token = ctx.secrets[tokenRef] || '';
    if (token) {
      ctx.headers.set('Authorization', `Bearer ${token}`);
    } else {
      console.warn(`[gateway] auth: secret "${tokenRef}" not resolved for connector "${ctx.connectorSlug}"`);
      ctx.headers.set('X-Gateway-Warning', 'missing-auth-secret');
    }
  },
};
