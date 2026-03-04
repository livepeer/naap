/**
 * Tests for AWS Signature V4 Signer
 *
 * Verifies canonical request construction, signing key derivation,
 * signature generation, and UNSIGNED-PAYLOAD mode.
 */

import { describe, it, expect } from 'vitest';
import {
  signAwsV4,
  toAmzDate,
  sha256Hex,
  deriveSigningKey,
  buildCanonicalHeaders,
  buildCanonicalQueryString,
} from '../aws-sig-v4';

describe('AWS Sig V4 helper functions', () => {
  it('toAmzDate formats ISO date correctly', () => {
    const date = new Date('2026-02-23T12:00:00.000Z');
    expect(toAmzDate(date)).toBe('20260223T120000Z');
  });

  it('sha256Hex hashes correctly', () => {
    const emptyHash = sha256Hex('');
    expect(emptyHash).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'
    );
  });

  it('deriveSigningKey produces a 32-byte buffer', () => {
    const key = deriveSigningKey('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20260223', 'us-east-1', 's3');
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);
  });

  it('buildCanonicalHeaders sorts and formats correctly', () => {
    const headers = new Headers();
    headers.set('Host', 'example.com');
    headers.set('X-Amz-Date', '20260223T120000Z');
    headers.set('Content-Type', 'application/octet-stream');

    const { canonicalHeaders, signedHeaders } = buildCanonicalHeaders(headers);
    expect(signedHeaders).toBe('content-type;host;x-amz-date');
    expect(canonicalHeaders).toContain('host:example.com\n');
    expect(canonicalHeaders).toContain('content-type:application/octet-stream\n');
  });

  it('buildCanonicalQueryString sorts params', () => {
    const params = new URLSearchParams();
    params.set('prefix', 'docs/');
    params.set('delimiter', '/');
    params.set('list-type', '2');

    const qs = buildCanonicalQueryString(params);
    expect(qs).toBe('delimiter=%2F&list-type=2&prefix=docs%2F');
  });

  it('buildCanonicalQueryString returns empty string for no params', () => {
    const params = new URLSearchParams();
    expect(buildCanonicalQueryString(params)).toBe('');
  });
});

describe('signAwsV4', () => {
  it('sets Authorization, x-amz-date, x-amz-content-sha256, and host headers', () => {
    const url = new URL('https://gateway.storjshare.io/my-bucket?list-type=2');
    const headers = new Headers();

    signAwsV4({
      method: 'GET',
      url,
      headers,
      accessKey: 'AKIAIOSFODNN7EXAMPLE',
      secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      region: 'us-1',
      service: 's3',
      signPayload: false,
    });

    expect(headers.has('authorization')).toBe(true);
    expect(headers.has('x-amz-date')).toBe(true);
    expect(headers.get('x-amz-content-sha256')).toBe('UNSIGNED-PAYLOAD');
    expect(headers.get('host')).toBe('gateway.storjshare.io');

    const auth = headers.get('authorization')!;
    expect(auth).toMatch(/^AWS4-HMAC-SHA256/);
    expect(auth).toContain('Credential=AKIAIOSFODNN7EXAMPLE/');
    expect(auth).toContain('/us-1/s3/aws4_request');
    expect(auth).toContain('SignedHeaders=');
    expect(auth).toContain('Signature=');
  });

  it('signs payload when signPayload=true', () => {
    const url = new URL('https://gateway.storjshare.io/my-bucket/test.txt');
    const headers = new Headers();
    const body = 'Hello, World!';

    signAwsV4({
      method: 'PUT',
      url,
      headers,
      body,
      accessKey: 'AKIAIOSFODNN7EXAMPLE',
      secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      region: 'us-1',
      service: 's3',
      signPayload: true,
    });

    const payloadHash = headers.get('x-amz-content-sha256')!;
    expect(payloadHash).not.toBe('UNSIGNED-PAYLOAD');
    expect(payloadHash).toBe(sha256Hex('Hello, World!'));
  });

  it('uses UNSIGNED-PAYLOAD by default', () => {
    const url = new URL('https://gateway.storjshare.io/my-bucket/test.txt');
    const headers = new Headers();

    signAwsV4({
      method: 'PUT',
      url,
      headers,
      body: 'some data',
      accessKey: 'AKIAIOSFODNN7EXAMPLE',
      secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      region: 'us-1',
      service: 's3',
    });

    expect(headers.get('x-amz-content-sha256')).toBe('UNSIGNED-PAYLOAD');
  });

  it('handles ArrayBuffer body for signing', () => {
    const url = new URL('https://gateway.storjshare.io/my-bucket/binary.bin');
    const headers = new Headers();
    const body = new TextEncoder().encode('binary content').buffer;

    signAwsV4({
      method: 'PUT',
      url,
      headers,
      body,
      accessKey: 'AKIAIOSFODNN7EXAMPLE',
      secretKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      region: 'us-1',
      service: 's3',
      signPayload: true,
    });

    const payloadHash = headers.get('x-amz-content-sha256')!;
    expect(payloadHash).toBe(sha256Hex('binary content'));
  });

  it('produces deterministic signatures for identical inputs', () => {
    const opts = {
      method: 'GET',
      url: new URL('https://s3.amazonaws.com/my-bucket'),
      headers: new Headers(),
      accessKey: 'AKID',
      secretKey: 'SECRET',
      region: 'us-east-1',
      service: 's3',
    };

    signAwsV4(opts);
    const sig1 = opts.headers.get('authorization')!;

    const opts2 = { ...opts, headers: new Headers() };
    signAwsV4(opts2);
    const sig2 = opts2.headers.get('authorization')!;

    expect(sig1).toBe(sig2);
  });

  it('encodes path segments in canonical URI', () => {
    const url = new URL('https://gateway.storjshare.io/my-bucket/path%20with%20spaces/file.txt');
    const headers = new Headers();

    signAwsV4({
      method: 'GET',
      url,
      headers,
      accessKey: 'AKID',
      secretKey: 'SECRET',
      region: 'us-1',
      service: 's3',
    });

    expect(headers.has('authorization')).toBe(true);
  });
});
