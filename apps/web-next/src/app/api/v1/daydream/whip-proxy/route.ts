/**
 * Daydream WHIP Proxy API Route
 * POST /api/v1/daydream/whip-proxy - Proxy WebRTC WHIP SDP handshake
 *
 * WHY: The WHIP endpoint (ai.livepeer.com) is a third-party server that
 * doesn't set Access-Control-Allow-Origin for localhost or any arbitrary
 * origin. Browsers block cross-origin fetch() to it. The actual WebRTC
 * media stream goes peer-to-peer and doesn't need this proxy — only the
 * initial SDP offer/answer exchange does.
 */

import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/db';
import { validateSession } from '@/lib/api/auth';
import { errors, getAuthToken } from '@/lib/api/response';
import { validateCSRF } from '@/lib/api/csrf';

const ALLOWED_HOSTS = ['ai.livepeer.com', 'livepeer.studio', 'api.daydream.live'];
const PROXY_TIMEOUT = 30_000;

/**
 * Verify the user has a valid Daydream API key
 */
async function verifyUserApiKey(userId: string): Promise<void> {
  const settings = await prisma.daydreamSettings.findUnique({
    where: { userId },
  });

  if (!settings?.apiKey && userId !== 'default-user') {
    const defaultSettings = await prisma.daydreamSettings.findUnique({
      where: { userId: 'default-user' },
    });
    if (defaultSettings?.apiKey) return; // key exists under default-user
  }

  if (!settings?.apiKey) {
    throw new Error('No Daydream API key configured. Go to Settings to add your API key.');
  }
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    // Auth check
    const token = getAuthToken(request);
    if (!token) {
      return errors.unauthorized('No auth token provided');
    }

    const csrfError = validateCSRF(request, token);
    if (csrfError) {
      return csrfError;
    }

    const user = await validateSession(token);
    if (!user) {
      return errors.unauthorized('Invalid or expired session');
    }

    // Verify user has an API key before proxying
    await verifyUserApiKey(user.id);

    // Get the target WHIP URL from the header
    const targetUrl = request.headers.get('X-WHIP-URL');
    if (!targetUrl) {
      return errors.badRequest('Missing X-WHIP-URL header');
    }

    // Validate the target host is allowed
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(targetUrl);
    } catch {
      return errors.badRequest('Invalid X-WHIP-URL');
    }

    if (!ALLOWED_HOSTS.includes(parsedUrl.hostname)) {
      return errors.forbidden(`Host not allowed: ${parsedUrl.hostname}`);
    }

    // Read the SDP body
    const sdpBody = await request.text();
    if (!sdpBody) {
      return errors.badRequest('Empty SDP body');
    }

    // Forward the request to the WHIP endpoint
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), PROXY_TIMEOUT);

    try {
      const proxyResponse = await fetch(targetUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/sdp',
        },
        body: sdpBody,
        signal: controller.signal,
      });

      clearTimeout(timeout);

      const responseBody = await proxyResponse.text();

      // Build the proxied response
      const headers = new Headers({
        'Content-Type': proxyResponse.headers.get('Content-Type') || 'application/sdp',
      });

      // Expose the Location header as X-WHIP-Resource (for WHIP resource management)
      const location = proxyResponse.headers.get('Location');
      if (location) {
        headers.set('X-WHIP-Resource', location);
      }

      return new NextResponse(responseBody, {
        status: proxyResponse.status,
        headers,
      });
    } catch (fetchErr: any) {
      clearTimeout(timeout);
      if (fetchErr?.name === 'AbortError') {
        return errors.internal('WHIP proxy request timed out');
      }
      throw fetchErr;
    }
  } catch (err: any) {
    console.error('WHIP proxy error:', err);
    const message = err?.message || 'WHIP proxy failed';
    if (message.includes('API key')) {
      return errors.badRequest(message);
    }
    return errors.internal(message);
  }
}
