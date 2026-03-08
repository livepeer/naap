/**
 * Proxy utility for deployment-manager shell routes.
 *
 * All deployment-manager logic lives in the plugin backend (port 4117).
 * Shell routes are thin proxies that validate auth then forward to the backend.
 */
import { NextRequest, NextResponse } from 'next/server';
import { validateSession } from '@/lib/api/auth';
import { getAuthToken } from '@/lib/api/response';

const PLUGIN_BACKEND = process.env.DEPLOYMENT_MANAGER_URL || 'http://localhost:4117';
const API_PREFIX = '/api/v1/deployment-manager';

/**
 * Proxy a request to the deployment-manager plugin backend.
 *
 * @param request - The incoming Next.js request
 * @param backendPath - The path after /api/v1/deployment-manager/ (e.g. "/deployments/123")
 * @param options - Override method, skip auth, etc.
 */
export async function proxyToBackend(
  request: NextRequest,
  backendPath: string,
  options?: { skipAuth?: boolean },
): Promise<NextResponse> {
  try {
    // Auth check (unless skipped for cron endpoints)
    if (!options?.skipAuth) {
      const token = getAuthToken(request);
      if (!token) return NextResponse.json({ success: false, error: 'Unauthorized' }, { status: 401 });
      const user = await validateSession(token);
      if (!user) return NextResponse.json({ success: false, error: 'Invalid session' }, { status: 401 });
    }

    // Build upstream URL with query params
    const url = new URL(request.url);
    const upstream = `${PLUGIN_BACKEND}${API_PREFIX}${backendPath}${url.search}`;

    // Forward request
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const auth = request.headers.get('authorization');
    if (auth) headers['Authorization'] = auth;

    const fetchOptions: RequestInit = {
      method: request.method,
      headers,
    };

    // Forward body for non-GET methods
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      try {
        const body = await request.text();
        if (body) fetchOptions.body = body;
      } catch {
        // No body — fine for DELETE etc.
      }
    }

    const res = await fetch(upstream, fetchOptions);
    const data = await res.json();
    return NextResponse.json(data, { status: res.status });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 502 });
  }
}
