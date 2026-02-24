/**
 * @naap/plugin-server-sdk
 *
 * Backend SDK for NaaP plugin servers.
 * Eliminates ~200 lines of Express boilerplate per plugin by providing
 * a standardized server factory.
 *
 * @example
 * ```typescript
 * import { createPluginServer } from '@naap/plugin-server-sdk';
 *
 * const server = createPluginServer({
 *   name: 'my-plugin',
 *   port: 4001,
 * });
 *
 * server.router.get('/items', async (req, res) => {
 *   res.json({ items: [] });
 * });
 *
 * server.start();
 * ```
 */

export { createPluginServer } from './server';
export type { PluginServerConfig, PluginServer, RateLimitConfig } from './server';
export { createAuthMiddleware } from './middleware/auth';
export type { AuthenticatedRequest } from './middleware/auth';
export { createRequestLogger } from './middleware/logging';
export { createErrorHandler } from './middleware/errorHandler';
export { createExternalProxy } from './middleware/externalProxy';
export type { ExternalProxyConfig } from './middleware/externalProxy';
