/**
 * Content Security Policy for Plugins
 *
 * Generates CSP headers for plugin loading and execution.
 */

/**
 * CSP configuration for plugins
 */
export interface PluginCSPConfig {
  /** Plugin name */
  pluginName: string;

  /** CDN URLs for the plugin bundle */
  bundleUrl?: string;

  /** CDN URLs for styles */
  stylesUrl?: string;

  /** Additional script sources */
  additionalScriptSources?: string[];

  /** Additional style sources */
  additionalStyleSources?: string[];

  /** Enable inline styles */
  allowInlineStyles?: boolean;

  /** Enable inline scripts (dangerous) */
  allowInlineScripts?: boolean;

  /** Enable eval (dangerous) */
  allowEval?: boolean;

  /** Enable web sockets */
  allowWebSockets?: boolean;

  /** Enable worker scripts */
  allowWorkers?: boolean;
}

/**
 * Default CSP sources
 */
const DEFAULT_SOURCES = {
  scripts: [
    "'self'",
    'https://blob.vercel-storage.com',
    'https://cdn.naap.io',
    'https://*.vercel.app',
  ],
  styles: [
    "'self'",
    "'unsafe-inline'", // Required for many CSS-in-JS libraries
    'https://blob.vercel-storage.com',
    'https://cdn.naap.io',
    'https://fonts.googleapis.com',
  ],
  fonts: [
    "'self'",
    'https://fonts.gstatic.com',
    'data:', // For base64 encoded fonts
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
    'wss://*.naap.io', // WebSocket support
  ],
  frame: [
    "'self'",
  ],
  object: [
    "'none'",
  ],
  base: [
    "'self'",
  ],
};

/**
 * Generates CSP directives for a plugin
 */
export function generatePluginCSP(config: PluginCSPConfig): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': [...DEFAULT_SOURCES.scripts],
    'style-src': [...DEFAULT_SOURCES.styles],
    'font-src': [...DEFAULT_SOURCES.fonts],
    'img-src': [...DEFAULT_SOURCES.images],
    'connect-src': [...DEFAULT_SOURCES.connect],
    'frame-src': [...DEFAULT_SOURCES.frame],
    'object-src': [...DEFAULT_SOURCES.object],
    'base-uri': [...DEFAULT_SOURCES.base],
  };

  // Add plugin-specific CDN URLs
  if (config.bundleUrl) {
    try {
      const bundleOrigin = new URL(config.bundleUrl).origin;
      directives['script-src'].push(bundleOrigin);
    } catch {
      // Invalid URL, skip
    }
  }

  if (config.stylesUrl) {
    try {
      const stylesOrigin = new URL(config.stylesUrl).origin;
      directives['style-src'].push(stylesOrigin);
    } catch {
      // Invalid URL, skip
    }
  }

  // Add additional sources
  if (config.additionalScriptSources) {
    directives['script-src'].push(...config.additionalScriptSources);
  }

  if (config.additionalStyleSources) {
    directives['style-src'].push(...config.additionalStyleSources);
  }

  // Inline permissions
  if (config.allowInlineStyles && !directives['style-src'].includes("'unsafe-inline'")) {
    directives['style-src'].push("'unsafe-inline'");
  }

  if (config.allowInlineScripts) {
    directives['script-src'].push("'unsafe-inline'");
  }

  if (config.allowEval) {
    directives['script-src'].push("'unsafe-eval'");
  }

  // WebSocket support
  if (config.allowWebSockets) {
    directives['connect-src'].push('wss:', 'ws:');
  }

  // Worker support
  if (config.allowWorkers) {
    directives['worker-src'] = ["'self'", 'blob:'];
  }

  // Build CSP string
  const cspParts: string[] = [];
  for (const [directive, sources] of Object.entries(directives)) {
    // Deduplicate sources
    const uniqueSources = [...new Set(sources)];
    cspParts.push(`${directive} ${uniqueSources.join(' ')}`);
  }

  return cspParts.join('; ');
}

/**
 * Generates a nonce for inline scripts
 */
export function generateNonce(): string {
  if (typeof window !== 'undefined' && window.crypto) {
    const array = new Uint8Array(16);
    window.crypto.getRandomValues(array);
    return btoa(String.fromCharCode(...array));
  }
  // Server-side fallback
  return Math.random().toString(36).substring(2, 18);
}

/**
 * Creates a meta tag for CSP
 */
export function createCSPMetaTag(csp: string): string {
  return `<meta http-equiv="Content-Security-Policy" content="${csp.replace(/"/g, '&quot;')}">`;
}

/**
 * Default CSP for all plugins (restrictive)
 */
export const DEFAULT_PLUGIN_CSP = generatePluginCSP({
  pluginName: 'default',
  allowInlineStyles: true,
  allowWebSockets: true,
});

/**
 * CSP for development mode (relaxed)
 */
export const DEV_PLUGIN_CSP = generatePluginCSP({
  pluginName: 'dev',
  allowInlineStyles: true,
  allowInlineScripts: true,
  allowEval: true, // HMR requires eval
  allowWebSockets: true,
  additionalScriptSources: [
    'http://localhost:*',
    'ws://localhost:*',
  ],
  additionalStyleSources: [
    'http://localhost:*',
  ],
});

/**
 * HTTP headers for plugin pages
 *
 * NOTE: Permissions-Policy MUST allow camera/microphone for UMD plugins
 * that run directly in the page (not in iframes). Plugins like daydream-video
 * need webcam access for their functionality.
 */
export function getPluginSecurityHeaders(config: PluginCSPConfig, isDev = false): Record<string, string> {
  const csp = isDev ? DEV_PLUGIN_CSP : generatePluginCSP(config);

  return {
    'Content-Security-Policy': csp,
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'X-XSS-Protection': '1; mode=block',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    // Allow camera/microphone for same-origin UMD plugins
    // This is required for plugins like daydream-video that need webcam access
    'Permissions-Policy': 'camera=(self), microphone=(self), display-capture=(self), geolocation=(self)',
  };
}

/**
 * Applies CSP headers to a Response
 */
export function applySecurityHeaders(
  response: Response,
  config: PluginCSPConfig,
  isDev = false
): Response {
  const headers = new Headers(response.headers);
  const securityHeaders = getPluginSecurityHeaders(config, isDev);

  for (const [key, value] of Object.entries(securityHeaders)) {
    headers.set(key, value);
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
