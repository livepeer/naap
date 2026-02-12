/**
 * Next.js Middleware — runs on every non-static request.
 *
 * Responsibilities:
 * 1. Observability headers (x-request-id, x-trace-id) on all requests
 * 2. Authentication enforcement (deny-by-default for all non-public routes)
 * 3. CSP & security headers for authenticated pages
 *
 * URL rewriting for plugin routes (e.g. /gateway → /plugins/serviceGateway)
 * is handled by next.config.js `beforeFiles` rewrites, NOT by this middleware.
 * This means adding a new plugin requires ZERO changes here — rewrites are
 * auto-discovered from plugins/\*\/plugin.json at config-load time.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// ─── CSP Configuration ────────────────────────────────────────────────────

const PLUGIN_CSP_SOURCES = {
  scripts: [
    "'self'",
    "'unsafe-inline'", // Required for UMD plugins
    "'unsafe-eval'", // Required for some plugin builds
    'https://blob.vercel-storage.com',
    'https://cdn.naap.io',
    'https://*.vercel.app',
  ],
  styles: [
    "'self'",
    "'unsafe-inline'",
    'https://blob.vercel-storage.com',
    'https://cdn.naap.io',
    'https://fonts.googleapis.com',
  ],
  fonts: [
    "'self'",
    'https://fonts.gstatic.com',
    'data:',
  ],
  images: [
    "'self'",
    'data:',
    'blob:',
    'https:',
  ],
  connect: [
    "'self'",
    'https://api.naap.io',
    'https://*.vercel.app',
    'https://blob.vercel-storage.com',
    'wss://*.naap.io',
    'http://localhost:*',
    'ws://localhost:*',
    // Livepeer / Daydream: WHIP/WHEP WebRTC ingest + API
    'https://*.livepeer.com',
    'https://ai.livepeer.com',
    'https://api.daydream.live',
  ],
  frame: [
    "'self'",
    // Livepeer playback player
    'https://lvpr.tv',
    'https://*.lvpr.tv',
  ],
};

function generateCSP(isDev: boolean): string {
  const devSources = isDev ? ['http://localhost:*', 'ws://localhost:*'] : [];

  const directives = [
    `default-src 'self'`,
    `script-src ${[...PLUGIN_CSP_SOURCES.scripts, ...devSources].join(' ')}`,
    `style-src ${PLUGIN_CSP_SOURCES.styles.join(' ')}`,
    `font-src ${PLUGIN_CSP_SOURCES.fonts.join(' ')}`,
    `img-src ${PLUGIN_CSP_SOURCES.images.join(' ')}`,
    `connect-src ${[...PLUGIN_CSP_SOURCES.connect, ...devSources].join(' ')}`,
    `frame-src ${[...PLUGIN_CSP_SOURCES.frame, 'http://localhost:*', 'https://*.vercel.app'].join(' ')}`,
    `object-src 'none'`,
    `base-uri 'self'`,
  ];

  return directives.join('; ');
}

// ─── Route Classification ─────────────────────────────────────────────────
//
// Deny-by-default: every route that is NOT explicitly public requires auth.
// This automatically covers all plugin routes (current and future) without
// needing a hardcoded list of plugin prefixes.

/** Prefixes that never require authentication */
const PUBLIC_PREFIXES = ['/api', '/_next', '/favicon.ico', '/docs', '/cdn'];

/** Exact paths reserved for unauthenticated users (login, register, etc.) */
const AUTH_ONLY_PATHS = ['/login', '/register', '/forgot-password', '/reset-password'];

function isPublicRoute(pathname: string): boolean {
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

function isAuthOnlyRoute(pathname: string): boolean {
  return AUTH_ONLY_PATHS.some(
    (p) => pathname === p || pathname.startsWith(p + '/'),
  );
}

// ─── Middleware ────────────────────────────────────────────────────────────

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Observability: inject request-id and trace-id on every request
  const requestId = request.headers.get('x-request-id') || crypto.randomUUID();
  const traceId = request.headers.get('x-trace-id') || crypto.randomUUID();

  // 1. Public API & static routes — pass through with observability headers
  if (isPublicRoute(pathname)) {
    const response = NextResponse.next();
    response.headers.set('x-request-id', requestId);
    response.headers.set('x-trace-id', traceId);
    response.headers.set('x-request-start', Date.now().toString());
    return response;
  }

  const token = request.cookies.get('naap_auth_token')?.value;

  // 2. Root path — redirect authenticated users to dashboard
  if (pathname === '/') {
    if (token) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    const response = NextResponse.next();
    response.headers.set('x-request-id', requestId);
    response.headers.set('x-trace-id', traceId);
    return response;
  }

  // 3. Auth-only routes (login, register) — pass through for unauthenticated
  if (isAuthOnlyRoute(pathname)) {
    const response = NextResponse.next();
    response.headers.set('x-request-id', requestId);
    response.headers.set('x-trace-id', traceId);
    return response;
  }

  // 4. ALL other routes require authentication (deny by default).
  //    This covers /dashboard, /settings, /plugins/*, /gateway, /forum, etc.
  //    New plugins are automatically protected without any code changes.
  if (!token) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('redirect', pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 5. Authenticated — proceed with security headers
  const response = NextResponse.next();
  const isDev = process.env.NODE_ENV === 'development';
  response.headers.set('Content-Security-Policy', generateCSP(isDev));
  response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('x-request-id', requestId);
  response.headers.set('x-trace-id', traceId);
  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico|public/).*)',
  ],
};
