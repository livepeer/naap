import { describe, it, expect } from 'vitest';
import { buildErrorResponse } from '../respond';

describe('buildErrorResponse with recovery metadata', () => {
  it('includes retryable:true for RATE_LIMITED', async () => {
    const res = buildErrorResponse('RATE_LIMITED', 'Too many requests', 429, 'req-1', 'trace-1');
    const body = await res.json();
    expect(res.status).toBe(429);
    expect(body.error.retryable).toBe(true);
    expect(body.error.suggestedAction).toBe('retry');
    expect(body.error.retryAfterMs).toBe(5000);
  });

  it('includes suggestedAction:retry for UPSTREAM_TIMEOUT', async () => {
    const res = buildErrorResponse('UPSTREAM_TIMEOUT', 'Upstream timed out', 504, 'req-1', null);
    const body = await res.json();
    expect(body.error.retryable).toBe(true);
    expect(body.error.suggestedAction).toBe('retry');
  });

  it('includes retryable:false for VALIDATION_ERROR', async () => {
    const res = buildErrorResponse('VALIDATION_ERROR', 'Bad input', 400, null, null);
    const body = await res.json();
    expect(body.error.retryable).toBe(false);
    expect(body.error.suggestedAction).toBe('reformulate');
  });

  it('includes suggestedAction:reformulate for PAYLOAD_TOO_LARGE', async () => {
    const res = buildErrorResponse('PAYLOAD_TOO_LARGE', 'Too big', 413, null, null);
    const body = await res.json();
    expect(body.error.retryable).toBe(false);
    expect(body.error.suggestedAction).toBe('reformulate');
  });

  it('includes suggestedAction:authenticate for UNAUTHORIZED', async () => {
    const res = buildErrorResponse('UNAUTHORIZED', 'Auth required', 401, null, null);
    const body = await res.json();
    expect(body.error.retryable).toBe(false);
    expect(body.error.suggestedAction).toBe('authenticate');
  });

  it('includes suggestedAction:abort for FORBIDDEN', async () => {
    const res = buildErrorResponse('FORBIDDEN', 'Not allowed', 403, null, null);
    const body = await res.json();
    expect(body.error.retryable).toBe(false);
    expect(body.error.suggestedAction).toBe('abort');
  });

  it('sets Retry-After header for RATE_LIMITED', () => {
    const res = buildErrorResponse('RATE_LIMITED', 'Too many', 429, null, null);
    expect(res.headers.get('Retry-After')).toBe('5');
  });

  it('sets Retry-After header for CIRCUIT_OPEN', () => {
    const res = buildErrorResponse('CIRCUIT_OPEN', 'Circuit open', 503, null, null);
    expect(res.headers.get('Retry-After')).toBe('30');
  });

  it('does NOT set Retry-After for non-retryable errors', () => {
    const res = buildErrorResponse('FORBIDDEN', 'Forbidden', 403, null, null);
    expect(res.headers.get('Retry-After')).toBeNull();
  });

  it('defaults to retryable:false for unknown error codes', async () => {
    const res = buildErrorResponse('SOME_UNKNOWN_ERROR', 'Unknown', 500, null, null);
    const body = await res.json();
    expect(body.error.retryable).toBe(false);
    expect(body.error.suggestedAction).toBe('abort');
  });

  it('preserves existing fields (details, meta)', async () => {
    const res = buildErrorResponse('NOT_FOUND', 'Not found', 404, 'req-1', 'trace-1', { resource: 'test' });
    const body = await res.json();
    expect(body.error.details).toEqual({ resource: 'test' });
    expect(body.meta.timestamp).toBeDefined();
    expect(body.success).toBe(false);
  });

  it('includes x-request-id and x-trace-id headers', () => {
    const res = buildErrorResponse('NOT_FOUND', 'Not found', 404, 'req-1', 'trace-1');
    expect(res.headers.get('x-request-id')).toBe('req-1');
    expect(res.headers.get('x-trace-id')).toBe('trace-1');
  });
});
