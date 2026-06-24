import { describe, it, expect } from 'vitest';
import { passthroughAuth } from '../../../transforms/auth/passthrough';
import { registry } from '../../../transforms';

describe('passthrough auth strategy (NAAP-5)', () => {
  it('is registered under the name "passthrough" (no silent fallback to none)', () => {
    const resolved = registry.getAuth('passthrough');
    expect(resolved).toBe(passthroughAuth);
    expect(resolved.name).toBe('passthrough');
  });

  it('injects no upstream credential (the forwarding is done by the transform orchestrator)', () => {
    const headers = new Headers({ Authorization: 'Bearer naap_caller_key' });
    passthroughAuth.inject({
      headers,
      authConfig: {},
      secrets: {},
      connectorSlug: 'sdk',
      method: 'POST',
      url: new URL('https://sdk.daydream.monster/inference'),
    });
    // The strategy is a no-op: it neither strips nor overwrites a header the
    // orchestrator already forwarded.
    expect(headers.get('Authorization')).toBe('Bearer naap_caller_key');
  });

  it('does not invent an Authorization header when none is present', () => {
    const headers = new Headers();
    passthroughAuth.inject({
      headers,
      authConfig: {},
      secrets: {},
      connectorSlug: 'sdk',
      method: 'GET',
      url: new URL('https://sdk.daydream.monster/capabilities'),
    });
    expect(headers.get('Authorization')).toBeNull();
  });
});
