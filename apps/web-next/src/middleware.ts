import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Plugin route mapping: path prefix → plugin name
// These routes are defined in the database seed and used by plugins
const PLUGIN_ROUTE_MAP: Record<string, string> = {
  '/wallet': 'myWallet',
  '/gateways': 'gatewayManager',
  '/orchestrators': 'orchestratorManager',
  '/capacity': 'capacityPlanner',
  '/analytics': 'networkAnalytics',
  '/leaderboard': 'networkAnalytics',
  '/forum': 'community',
  '/developers': 'developerApi',
  '/publish': 'pluginPublisher',
  '/daydream': 'daydreamVideo',
  '/my-dashboard': 'myDashboard',
  // Note: /marketplace and /dashboard have their own page.tsx files
  // /dashboard is the shell overview page, /my-dashboard is the Metabase plugin
};

// CSP configuration for plugin pages
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

// Generate CSP header string for plugin pages
function generatePluginCSP(isDev: boolean): string {
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

// Routes that require authentication
const protectedRoutes = [
  '/dashboard',
  '/settings',
  '/plugins',
  '/admin',
  '/teams',
  '/releases',
  '/feedback',
  '/marketplace',
  '/treasury',
  '/governance',
  // Add plugin routes as protected
  ...Object.keys(PLUGIN_ROUTE_MAP),
];

// Routes that are only for unauthenticated users
const authRoutes = [
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',
];

// Routes that should skip middleware entirely
const publicRoutes = [
  '/api',
  '/_next',
  '/favicon.ico',
  '/docs',
];

/**
 * Check if a path matches a plugin route and return the plugin name
 */
function getPluginForPath(pathname: string): string | null {
  for (const [routePrefix, pluginName] of Object.entries(PLUGIN_ROUTE_MAP)) {
    if (pathname === routePrefix || pathname.startsWith(routePrefix + '/')) {
      return pluginName;
    }
  }
  return null;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // --- Observability: inject request-id and trace-id on every request ---
  const requestId = request.headers.get('x-request-id') || crypto.randomUUID();
  const traceId = request.headers.get('x-trace-id') || crypto.randomUUID();

  // For API routes, add observability headers and continue
  if (publicRoutes.some(route => pathname.startsWith(route))) {
    const response = NextResponse.next();
    response.headers.set('x-request-id', requestId);
    response.headers.set('x-trace-id', traceId);
    // Forward to downstream via request headers mutation
    response.headers.set('x-request-start', Date.now().toString());
    return response;
  }

  // Get the auth token from cookies
  const token = request.cookies.get('naap_auth_token')?.value;

  // Check if this is a plugin route that needs rewriting
  const pluginName = getPluginForPath(pathname);
  if (pluginName) {
    // Require authentication for plugin routes
    if (!token) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }

    // Rewrite to the plugin loader page, preserving the original URL
    const rewriteUrl = new URL(`/plugins/${pluginName}`, request.url);
    const response = NextResponse.rewrite(rewriteUrl);
    
    // Add CSP headers for plugin pages
    const isDev = process.env.NODE_ENV === 'development';
    response.headers.set('Content-Security-Policy', generatePluginCSP(isDev));
    response.headers.set('X-Content-Type-Options', 'nosniff');
    response.headers.set('X-Frame-Options', 'SAMEORIGIN');
    response.headers.set('X-XSS-Protection', '1; mode=block');
    response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Permissions-Policy is set globally in next.config.js headers()
    // to ensure camera/microphone work after client-side navigation.
    // No need to set it here per-route.

    // Observability headers
    response.headers.set('x-request-id', requestId);
    response.headers.set('x-trace-id', traceId);

    return response;
  }

  // Handle root path - redirect to dashboard if authenticated
  if (pathname === '/') {
    if (token) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
    // Allow unauthenticated access to home page
    return NextResponse.next();
  }

  // Check if trying to access protected route without auth
  if (protectedRoutes.some(route => pathname === route || pathname.startsWith(route + '/'))) {
    if (!token) {
      const loginUrl = new URL('/login', request.url);
      loginUrl.searchParams.set('redirect', pathname);
      return NextResponse.redirect(loginUrl);
    }
  }

  // Check if authenticated user is trying to access auth routes
  if (authRoutes.some(route => pathname.startsWith(route))) {
    if (token) {
      return NextResponse.redirect(new URL('/dashboard', request.url));
    }
  }

  const response = NextResponse.next();
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
