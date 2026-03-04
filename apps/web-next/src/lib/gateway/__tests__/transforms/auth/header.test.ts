import { describe, it, expect } from 'vitest';
import { headerAuth } from '../../../transforms/auth/header';

describe('header auth strategy', () => {
  it('sets custom headers with secret interpolation', () => {
    const headers = new Headers();
    headerAuth.inject({
      headers,
      authConfig: {
        headers: {
          'apikey': '{{secrets.anon_key}}',
          'Authorization': 'Bearer {{secrets.service_key}}',
        },
      },
      secrets: { anon_key: 'anon-123', service_key: 'svc-456' },
      method: 'GET',
      url: new URL('https://example.supabase.co'),
    });
    expect(headers.get('apikey')).toBe('anon-123');
    expect(headers.get('Authorization')).toBe('Bearer svc-456');
  });

  it('handles missing secrets gracefully (empty string)', () => {
    const headers = new Headers();
    headerAuth.inject({
      headers,
      authConfig: { headers: { 'Api-Key': '{{secrets.missing}}' } },
      secrets: {},
      method: 'GET',
      url: new URL('https://example.com'),
    });
    expect(headers.get('Api-Key')).toBe('');
  });
});
