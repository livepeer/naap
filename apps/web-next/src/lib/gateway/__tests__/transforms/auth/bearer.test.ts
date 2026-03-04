import { describe, it, expect } from 'vitest';
import { bearerAuth } from '../../../transforms/auth/bearer';

describe('bearer auth strategy', () => {
  it('sets Authorization header with token', () => {
    const headers = new Headers();
    bearerAuth.inject({
      headers,
      authConfig: { tokenRef: 'api_key' },
      secrets: { api_key: 'sk-test-123' },
      method: 'POST',
      url: new URL('https://api.openai.com/v1/chat'),
    });
    expect(headers.get('Authorization')).toBe('Bearer sk-test-123');
  });

  it('defaults to "token" ref when tokenRef not specified', () => {
    const headers = new Headers();
    bearerAuth.inject({
      headers,
      authConfig: {},
      secrets: { token: 'default-tok' },
      method: 'GET',
      url: new URL('https://example.com'),
    });
    expect(headers.get('Authorization')).toBe('Bearer default-tok');
  });

  it('does not set header when secret is missing', () => {
    const headers = new Headers();
    bearerAuth.inject({
      headers,
      authConfig: { tokenRef: 'missing' },
      secrets: {},
      method: 'GET',
      url: new URL('https://example.com'),
    });
    expect(headers.get('Authorization')).toBeNull();
  });
});
