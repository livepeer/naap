/**
 * WHIP SDP Proxy — Dedicated route for WebRTC signaling
 *
 * The generic gateway engine cannot handle WHIP because it requires:
 * - Dynamic target URL via X-WHIP-URL header (not a fixed upstream)
 * - Non-JSON content type (application/sdp)
 *
 * This lightweight route validates the host, authenticates the caller,
 * and proxies the SDP offer/answer. The actual media stream is peer-to-peer.
 */

import { NextRequest, NextResponse } from 'next/server';
import { authorize } from '@/lib/gateway/authorize';

const ALLOWED_HOSTS = ['ai.livepeer.com', 'livepeer.studio', 'api.daydream.live'];
const TIMEOUT_MS = 30_000;

export async function POST(request: NextRequest): Promise<Response> {
  const auth = await authorize(request);
  if (!auth) {
    return NextResponse.json(
      { success: false, error: { message: 'Unauthorized' } },
      { status: 401 }
    );
  }

  const targetUrl = request.headers.get('x-whip-url');
  if (!targetUrl) {
    return NextResponse.json(
      { success: false, error: { message: 'Missing X-WHIP-URL header' } },
      { status: 400 }
    );
  }

  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    return NextResponse.json(
      { success: false, error: { message: 'Invalid URL in X-WHIP-URL header' } },
      { status: 400 }
    );
  }

  const hostname = parsed.hostname.replace(/\.$/, '').toLowerCase();
  const allowed = ALLOWED_HOSTS.some(
    (h) => hostname === h || hostname.endsWith(`.${h}`)
  );
  if (!allowed) {
    return NextResponse.json(
      { success: false, error: { message: `Host "${parsed.hostname}" is not allowed` } },
      { status: 400 }
    );
  }

  const body = await request.text();
  if (!body) {
    return NextResponse.json(
      { success: false, error: { message: 'Request body (SDP) is required' } },
      { status: 400 }
    );
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(targetUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/sdp' },
      body,
      signal: controller.signal,
    });
    clearTimeout(timer);

    if (!upstream.ok) {
      const errText = await upstream.text();
      return NextResponse.json(
        { success: false, error: { message: `WHIP server returned ${upstream.status}: ${errText}` } },
        { status: upstream.status }
      );
    }

    const answerSdp = await upstream.text();
    const headers = new Headers({ 'Content-Type': 'application/sdp' });

    const location = upstream.headers.get('Location');
    if (location) {
      headers.set('X-WHIP-Resource', location);
    }

    return new Response(answerSdp, { status: 200, headers });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') {
      return NextResponse.json(
        { success: false, error: { message: 'WHIP proxy timed out' } },
        { status: 504 }
      );
    }
    return NextResponse.json(
      { success: false, error: { message: 'WHIP proxy failed' } },
      { status: 502 }
    );
  }
}
