import type { AuthStrategy, AuthContext } from '../types';

export const queryAuth: AuthStrategy = {
  name: 'query',
  inject(ctx: AuthContext): void {
    const paramName = (ctx.authConfig.paramName as string) || 'key';
    const secretRef = (ctx.authConfig.secretRef as string) || 'token';
    const secretValue = ctx.secrets[secretRef];
    if (secretValue) {
      ctx.url.searchParams.set(paramName, secretValue);
    }
  },
};
