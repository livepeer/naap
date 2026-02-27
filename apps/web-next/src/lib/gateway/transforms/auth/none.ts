import type { AuthStrategy, AuthContext } from '../types';

export const noneAuth: AuthStrategy = {
  name: 'none',
  inject(_ctx: AuthContext): void {
    // No authentication required
  },
};
