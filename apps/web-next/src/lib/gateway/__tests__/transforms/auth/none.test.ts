import { describe, it, expect } from 'vitest';
import { noneAuth } from '../../../transforms/auth/none';
import { naapApiUrlForAuthTests } from '../../test-urls';

describe('none auth strategy', () => {
  it('does not modify headers', () => {
    const headers = new Headers();
    noneAuth.inject({
      headers,
      authConfig: {},
      secrets: {},
      method: 'GET',
      url: naapApiUrlForAuthTests(),
    });
    expect(headers.get('Authorization')).toBeNull();
  });
});
