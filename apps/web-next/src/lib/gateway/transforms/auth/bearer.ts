import type { AuthStrategy, AuthContext } from '../types';

export const bearerAuth: AuthStrategy = {
  name: 'bearer',
  inject(ctx: AuthContext): void {
    const tokenRef =
      typeof ctx.authConfig.tokenRef === 'string' && ctx.authConfig.tokenRef
        ? ctx.authConfig.tokenRef
        : 'token';
    const token = ctx.secrets[tokenRef] || '';
    if (token) {
      ctx.headers.set('Authorization', `Bearer ${token}`);
    } else {
      console.warn(`[gateway] auth: secret "${tokenRef}" not resolved for connector "${ctx.connectorSlug}"`);
      ctx.headers.set('X-Gateway-Warning', 'missing-auth-secret');
    }
  },
};
