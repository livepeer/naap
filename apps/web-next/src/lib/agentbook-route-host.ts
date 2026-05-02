/**
 * Shared host helper for AgentBook plugin route handlers.
 *
 * Wraps the plugin's Express app with diagnostic error reporting. If
 * the plugin module fails to import (e.g. Prisma binary not shipped to
 * the function bundle, missing env var at module load), we surface the
 * actual error message in the response body instead of letting Next.js
 * swallow it as an empty 500.
 */

import 'server-only';
import type { NextRequest } from 'next/server';
import { dispatchToExpress } from '@/lib/express-adapter';
import { resolveAgentbookTenant } from '@/lib/agentbook-tenant';

type ExpressApp = (req: unknown, res: unknown, next?: (err?: unknown) => void) => void;

interface AppLoader {
  loaded: ExpressApp | null;
  error: Error | null;
  promise: Promise<{ app?: ExpressApp; error?: Error }> | null;
}

export function makeRouteHandler(plugin: string, importApp: () => Promise<{ app: ExpressApp }>) {
  const cache: AppLoader = { loaded: null, error: null, promise: null };

  async function getApp(): Promise<ExpressApp> {
    if (cache.loaded) return cache.loaded;
    if (cache.error) throw cache.error;
    if (!cache.promise) {
      cache.promise = importApp()
        .then((mod) => {
          if (!mod.app) throw new Error(`module @naap/plugin-${plugin}-backend has no \`app\` export`);
          cache.loaded = mod.app;
          return { app: mod.app };
        })
        .catch((err) => {
          cache.error = err instanceof Error ? err : new Error(String(err));
          return { error: cache.error };
        });
    }
    const result = await cache.promise;
    if (result.error) throw result.error;
    return result.app!;
  }

  return async function handler(request: NextRequest): Promise<Response> {
    try {
      const app = await getApp();
      const tenantId = await resolveAgentbookTenant(request);
      return await dispatchToExpress(app, request, { extraHeaders: { 'x-tenant-id': tenantId } });
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      console.error(`[route-host:${plugin}] handler failed:`, error);
      return new Response(
        JSON.stringify({
          success: false,
          plugin,
          error: { message: error.message, stack: error.stack?.split('\n').slice(0, 8).join('\n') },
          path: new URL(request.url).pathname,
          timestamp: new Date().toISOString(),
        }),
        { status: 500, headers: { 'Content-Type': 'application/json' } }
      );
    }
  };
}
