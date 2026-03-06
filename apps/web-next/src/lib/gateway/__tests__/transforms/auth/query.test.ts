import { describe, it, expect } from 'vitest';
import { queryAuth } from '../../../transforms/auth/query';

describe('query auth strategy', () => {
  it('appends secret as query parameter', () => {
    const url = new URL('https://generativelanguage.googleapis.com/v1/models');
    const headers = new Headers();
    queryAuth.inject({
      headers,
      authConfig: { paramName: 'key', secretRef: 'gemini_key' },
      secrets: { gemini_key: 'AIza-test' },
      method: 'POST',
      url,
    });
    expect(url.searchParams.get('key')).toBe('AIza-test');
  });

  it('defaults to key/token when config not specified', () => {
    const url = new URL('https://example.com/api');
    const headers = new Headers();
    queryAuth.inject({
      headers,
      authConfig: {},
      secrets: { token: 'default-key' },
      method: 'GET',
      url,
    });
    expect(url.searchParams.get('key')).toBe('default-key');
  });

  it('does not set param when secret is missing', () => {
    const url = new URL('https://example.com/api');
    const headers = new Headers();
    queryAuth.inject({
      headers,
      authConfig: { secretRef: 'missing' },
      secrets: {},
      method: 'GET',
      url,
    });
    expect(url.searchParams.has('key')).toBe(false);
  });
});
