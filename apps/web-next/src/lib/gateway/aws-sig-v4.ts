/**
 * AWS Signature Version 4 Signer
 *
 * Provider-agnostic implementation for signing requests to any
 * S3-compatible service (Storj, R2, B2, MinIO, Spaces, Wasabi, AWS S3).
 *
 * Pure functions, no framework dependencies. Uses Node.js built-in crypto.
 */

import * as crypto from 'crypto';

export interface AwsV4SignOptions {
  method: string;
  url: URL;
  headers: Headers;
  body?: ArrayBuffer | string | null;
  accessKey: string;
  secretKey: string;
  region: string;
  service: string;
  signPayload?: boolean;
}

/**
 * Sign a request using AWS Signature Version 4.
 * Mutates `opts.headers` in-place, adding Authorization, x-amz-date,
 * x-amz-content-sha256, and Host headers.
 */
export function signAwsV4(opts: AwsV4SignOptions): void {
  const { method, url, headers, accessKey, secretKey, region, service } = opts;
  const signPayload = opts.signPayload ?? false;

  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);

  headers.set('host', url.host);
  headers.set('x-amz-date', amzDate);

  const payloadHash = signPayload
    ? hashPayload(opts.body)
    : 'UNSIGNED-PAYLOAD';
  headers.set('x-amz-content-sha256', payloadHash);

  const { canonicalHeaders, signedHeaders } = buildCanonicalHeaders(headers);
  const canonicalQueryString = buildCanonicalQueryString(url.searchParams);
  const canonicalUri = encodeCanonicalUri(url.pathname);

  const canonicalRequest = [
    method.toUpperCase(),
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join('\n');

  const signingKey = deriveSigningKey(secretKey, dateStamp, region, service);
  const signature = hmacHex(signingKey, stringToSign);

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKey}/${credentialScope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;
  headers.set('authorization', authorization);
}

// ── Internal helpers (exported for testing) ──

export function toAmzDate(date: Date): string {
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

export function sha256Hex(data: string): string {
  return crypto.createHash('sha256').update(data, 'utf8').digest('hex');
}

export function hmacHex(key: Buffer, data: string): string {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest('hex');
}

function hmacBuffer(key: Buffer | string, data: string): Buffer {
  return crypto.createHmac('sha256', key).update(data, 'utf8').digest();
}

export function deriveSigningKey(
  secretKey: string,
  dateStamp: string,
  region: string,
  service: string,
): Buffer {
  const kDate = hmacBuffer(`AWS4${secretKey}`, dateStamp);
  const kRegion = hmacBuffer(kDate, region);
  const kService = hmacBuffer(kRegion, service);
  return hmacBuffer(kService, 'aws4_request');
}

function hashPayload(body: ArrayBuffer | string | null | undefined): string {
  const hash = crypto.createHash('sha256');
  if (typeof body === 'string') {
    hash.update(body, 'utf8');
  } else if (body != null && typeof body === 'object' && 'byteLength' in body) {
    hash.update(Buffer.from(body as ArrayBuffer));
  }
  return hash.digest('hex');
}

export function buildCanonicalHeaders(headers: Headers): {
  canonicalHeaders: string;
  signedHeaders: string;
} {
  const entries: [string, string][] = [];
  headers.forEach((value, key) => {
    entries.push([key.toLowerCase(), value.trim()]);
  });
  entries.sort((a, b) => a[0].localeCompare(b[0]));

  const canonicalHeaders = entries.map(([k, v]) => `${k}:${v}\n`).join('');
  const signedHeaders = entries.map(([k]) => k).join(';');
  return { canonicalHeaders, signedHeaders };
}

export function buildCanonicalQueryString(params: URLSearchParams): string {
  const entries: [string, string][] = [];
  params.forEach((value, key) => {
    entries.push([
      encodeURIComponent(key),
      encodeURIComponent(value),
    ]);
  });
  entries.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1].localeCompare(b[1]));
  return entries.map(([k, v]) => `${k}=${v}`).join('&');
}

function encodeCanonicalUri(pathname: string): string {
  return pathname
    .split('/')
    .map((segment) => encodeURIComponent(decodeURIComponent(segment)))
    .join('/');
}
