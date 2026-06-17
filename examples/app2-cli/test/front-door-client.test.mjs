/**
 * APP-2 guardrail tests (node:test — zero-dep, runnable via `npm test`).
 *
 * Proves the second app's front-door request/response logic is correct and
 * provider-agnostic: it builds a native-key validate call with a per-app
 * X-App-Id, enforces capability gating, and consumes the provider-issued signer
 * session opaquely.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildInferenceRequest,
  buildValidateRequest,
  hasCapability,
  parseFrontDoorResponse,
  redactKey,
} from '../src/front-door-client.mjs';

test('redactKey masks the secret but keeps a hint', () => {
  assert.equal(redactKey('naap_abcdef123456WXYZ'), 'naap_…WXYZ');
  assert.equal(redactKey(''), '(none)');
});

test('buildValidateRequest targets the front door with bearer + X-App-Id', () => {
  const req = buildValidateRequest({
    frontDoorUrl: 'https://naap.example',
    apiKey: 'naap_secrettoken',
    appId: 'naap-sample-cli',
    requestId: 'req-1',
  });
  assert.equal(req.url, 'https://naap.example/api/v1/keys/validate');
  assert.equal(req.method, 'POST');
  assert.equal(req.headers.authorization, 'Bearer naap_secrettoken');
  assert.equal(req.headers['x-app-id'], 'naap-sample-cli');
  assert.equal(req.headers['x-request-id'], 'req-1');
});

test('buildValidateRequest rejects a non-native key (D1: naap_ only)', () => {
  assert.throws(
    () =>
      buildValidateRequest({
        frontDoorUrl: 'https://naap.example',
        apiKey: 'pmth_providertoken',
        appId: 'naap-sample-cli',
      }),
    /native naap_ key/,
  );
});

test('buildValidateRequest requires an appId for attribution', () => {
  assert.throws(
    () => buildValidateRequest({ frontDoorUrl: 'https://x', apiKey: 'naap_k', appId: '' }),
    /appId is required/,
  );
});

test('parseFrontDoorResponse unwraps the {success,data} envelope', () => {
  const parsed = parseFrontDoorResponse({
    success: true,
    data: {
      valid: true,
      user: { sub: 'u1' },
      app: { id: 'naap-sample-cli', scopes: ['gateway', 'llm'] },
      billingAccount: { id: 'acct_stub_1', providerSlug: 'stub' },
      capabilities: ['text-to-image:sdxl'],
      quota: { remaining: 10 },
      signerSession: { url: 'https://signer/x', headers: { Authorization: 'Bearer t' } },
    },
  });
  assert.equal(parsed.valid, true);
  assert.equal(parsed.app.id, 'naap-sample-cli');
  assert.equal(parsed.billingAccount.providerSlug, 'stub');
  assert.deepEqual(parsed.capabilities, ['text-to-image:sdxl']);
});

test('hasCapability enforces the gated capability set', () => {
  assert.equal(hasCapability(['text-to-image:sdxl'], 'text-to-image:sdxl'), true);
  assert.equal(hasCapability(['text-to-image:sdxl'], 'text-to-video:ltx'), false);
});

test('buildInferenceRequest forwards an opaque signer session (header style)', () => {
  const req = buildInferenceRequest({
    signerSession: { url: 'https://signer.stub/session', headers: { Authorization: 'Bearer stub-tok' } },
    capability: 'text-to-image:sdxl',
    prompt: 'hi',
  });
  assert.equal(req.url, 'https://signer.stub/session');
  assert.equal(req.headers.Authorization, 'Bearer stub-tok');
  assert.equal(req.body.capability, 'text-to-image:sdxl');
});

test('buildInferenceRequest supports accessToken-style sessions', () => {
  const req = buildInferenceRequest({
    signerSession: { accessToken: 'abc', tokenType: 'Bearer' },
    capability: 'text-to-image:sdxl',
  });
  assert.equal(req.headers.authorization, 'Bearer abc');
});

test('buildInferenceRequest returns null without a signer session', () => {
  assert.equal(buildInferenceRequest({ signerSession: null, capability: 'x' }), null);
});
