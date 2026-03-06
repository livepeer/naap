import { describe, it, expect } from 'vitest';
import { basicAuth } from '../../../transforms/auth/basic';

describe('basic auth strategy', () => {
  it('sets Authorization header with base64-encoded credentials', () => {
    const headers = new Headers();
    basicAuth.inject({
      headers,
      authConfig: { usernameRef: 'user', passwordRef: 'pass' },
      secrets: { user: 'admin', pass: 's3cret' },
      method: 'POST',
      url: new URL('https://api.clickhouse.cloud'),
    });
    const expected = Buffer.from('admin:s3cret').toString('base64');
    expect(headers.get('Authorization')).toBe(`Basic ${expected}`);
  });

  it('defaults to username/password refs', () => {
    const headers = new Headers();
    basicAuth.inject({
      headers,
      authConfig: {},
      secrets: { username: 'u', password: 'p' },
      method: 'GET',
      url: new URL('https://example.com'),
    });
    const expected = Buffer.from('u:p').toString('base64');
    expect(headers.get('Authorization')).toBe(`Basic ${expected}`);
  });
});
