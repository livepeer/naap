import { describe, it, expect } from 'vitest';
import { noneAuth } from '../../../transforms/auth/none';

describe('none auth strategy', () => {
  it('does not modify headers', () => {
    const headers = new Headers();
    noneAuth.inject({
      headers,
      authConfig: {},
      secrets: {},
      method: 'GET',
      url: new URL('https://leaderboard-api.livepeer.cloud'),
    });
    expect(headers.get('Authorization')).toBeNull();
  });
});
