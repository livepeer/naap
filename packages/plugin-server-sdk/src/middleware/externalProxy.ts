/**
 * External API Proxy Middleware
 *
 * Reusable middleware for proxying requests to external APIs that don't
 * support CORS. The browser can't directly call these APIs, so the plugin
 * backend acts as a transparent proxy.
 *
 * PATTERN: Any plugin that needs to call a third-party API from the
 * frontend should use this proxy instead of making direct browser fetch()
 * calls. This avoids CORS issues and also keeps API keys server-side.
 *
 * @example
 * ```typescript
 * import { createExternalProxy } from '@naap/plugin-server-sdk';
 *
 * // Simple proxy for a single external API
 * router.post(
 *   '/whip-proxy',
 *   ...createExternalProxy({
 *     allowedHosts: ['ai.livepeer.com', 'livepeer.studio'],
 *     targetUrlHeader: 'X-WHIP-URL',
 *     contentType: 'application/sdp',
 *     exposeHeaders: ['X-WHIP-Resource'],
 *   })
 * );
 *
 * // Generic JSON proxy for any allowed API
 * router.post(
 *   '/api-proxy',
 *   ...createExternalProxy({
 *     allowedHosts: ['api.example.com'],
 *     targetUrlHeader: 'X-Target-URL',
 *   })
 * );
 * ```
 */

import express, { type Request, type Response, type RequestHandler } from 'express';

export interface ExternalProxyConfig {
  /**
   * Allowed hostnames for the target URL (SSRF protection).
   * Checks if the target hostname ends with one of these values.
   * Example: ['ai.livepeer.com', 'livepeer.studio']
   */
  allowedHosts: string[];

  /**
   * Request header that contains the target URL.
   * Default: 'X-Target-URL'
   */
  targetUrlHeader?: string;

  /**
   * Content type for the proxied request/response.
   * Default: 'application/json'
   *
   * If set to a non-JSON type (e.g., 'application/sdp'), the middleware
   * will use express.text() for body parsing and return the response as text.
   */
  contentType?: string;

  /**
   * Maximum body size.
   * Default: '1mb'
   */
  bodyLimit?: string;

  /**
   * Response headers from the external API to expose to the browser.
   * These are returned via custom X-* headers to avoid CORS issues.
   * Example: [{ from: 'Location', to: 'X-WHIP-Resource' }]
   */
  exposeHeaders?: Array<{ from: string; to: string }>;

  /**
   * Additional headers to forward to the external API.
   * Can be a static map or a function that extracts headers from the request.
   */
  forwardHeaders?:
    | Record<string, string>
    | ((req: Request) => Record<string, string>);

  /**
   * Request timeout in milliseconds.
   * Default: 30000 (30 seconds)
   */
  timeout?: number;

  /**
   * Optional authorization callback. Called before proxying.
   * Throw an error or return false to deny the request.
   */
  authorize?: (req: Request) => boolean | Promise<boolean>;

  /**
   * Optional logger. Default: console.log / console.error
   */
  logger?: {
    info: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
  };
}

/**
 * Creates an array of Express middleware handlers that proxy requests
 * to an external API, avoiding CORS issues.
 *
 * Returns [bodyParser, proxyHandler] — spread into router.post().
 */
export function createExternalProxy(config: ExternalProxyConfig): RequestHandler[] {
  const {
    allowedHosts,
    targetUrlHeader = 'X-Target-URL',
    contentType = 'application/json',
    bodyLimit = '1mb',
    exposeHeaders = [],
    forwardHeaders,
    timeout = 30_000,
    authorize,
    logger = { info: console.log, error: console.error },
  } = config;

  const isJson = contentType === 'application/json';

  // Pick the right body parser based on content type
  const bodyParser: RequestHandler = isJson
    ? express.json({ limit: bodyLimit })
    : express.text({ type: contentType, limit: bodyLimit });

  const proxyHandler: RequestHandler = async (req: Request, res: Response) => {
    try {
      // 1. Authorization check
      if (authorize) {
        const ok = await authorize(req);
        if (ok === false) {
          return res.status(403).json({
            success: false,
            error: { message: 'Proxy request not authorized' },
          });
        }
      }

      // 2. Extract target URL from header
      const targetUrl = req.headers[targetUrlHeader.toLowerCase()] as string;
      if (!targetUrl) {
        return res.status(400).json({
          success: false,
          error: { message: `Missing ${targetUrlHeader} header` },
        });
      }

      // 3. Validate URL (SSRF protection)
      let parsed: URL;
      try {
        parsed = new URL(targetUrl);
      } catch {
        return res.status(400).json({
          success: false,
          error: { message: `Invalid URL in ${targetUrlHeader} header` },
        });
      }

      // SSRF protection: exact hostname match or valid subdomain match
      // Using `.${h}` prefix prevents attacks like "evil-livepeer.com" matching "livepeer.com"
      const isAllowedHost = allowedHosts.some(
        (h) => parsed.hostname === h || parsed.hostname.endsWith(`.${h}`)
      );
      if (!isAllowedHost) {
        return res.status(400).json({
          success: false,
          error: {
            message: `Host "${parsed.hostname}" is not in the allowed list`,
          },
        });
      }

      // 4. Build outbound headers
      const outboundHeaders: Record<string, string> = {
        'Content-Type': contentType,
      };

      if (forwardHeaders) {
        const extra =
          typeof forwardHeaders === 'function'
            ? forwardHeaders(req)
            : forwardHeaders;
        Object.assign(outboundHeaders, extra);
      }

      // 5. Get body
      const body = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
      if (!body || body === '{}' || body === 'undefined') {
        return res.status(400).json({
          success: false,
          error: { message: `Request body is required (Content-Type: ${contentType})` },
        });
      }

      logger.info(
        `[ExternalProxy] Forwarding ${req.method} to ${parsed.hostname}${parsed.pathname}`
      );

      // 6. Forward the request
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);

      let externalRes: globalThis.Response;
      try {
        externalRes = await fetch(targetUrl, {
          method: req.method || 'POST',
          headers: outboundHeaders,
          body,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timeoutId);
      }

      // 7. Handle errors from external API
      if (!externalRes.ok) {
        const errorText = await externalRes.text();
        logger.error(
          `[ExternalProxy] Error: ${externalRes.status} - ${errorText}`
        );
        return res.status(externalRes.status).json({
          success: false,
          error: {
            message: `External API returned ${externalRes.status}: ${errorText}`,
          },
        });
      }

      // 8. Return the response
      const responseBody = await externalRes.text();

      // Set content type on our response
      res.set('Content-Type', isJson ? 'application/json' : contentType);

      // Expose requested headers
      for (const { from, to } of exposeHeaders) {
        const val = externalRes.headers.get(from);
        if (val) {
          res.set(to, val);
        }
      }

      res.send(responseBody);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') {
        logger.error('[ExternalProxy] Request timed out');
        return res.status(504).json({
          success: false,
          error: { message: 'External API request timed out' },
        });
      }
      logger.error('[ExternalProxy] Error:', err);
      res.status(500).json({
        success: false,
        error: { message: 'External proxy failed' },
      });
    }
  };

  return [bodyParser, proxyHandler];
}
