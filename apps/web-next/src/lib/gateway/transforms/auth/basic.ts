import type { AuthStrategy, AuthContext } from '../types';

export const basicAuth: AuthStrategy = {
  name: 'basic',
  inject(ctx: AuthContext): void {
    const userRef = (ctx.authConfig.usernameRef as string) || 'username';
    const passRef = (ctx.authConfig.passwordRef as string) || 'password';
    const username = ctx.secrets[userRef] || '';
    const password = ctx.secrets[passRef] || '';
    const encoded = Buffer.from(`${username}:${password}`).toString('base64');
    ctx.headers.set('Authorization', `Basic ${encoded}`);
  },
};
