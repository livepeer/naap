/**
 * Plugin port configuration for the API proxy route.
 *
 * These ports must match the values in:
 *   - packages/plugin-sdk/src/config/ports.ts (PLUGIN_PORTS)
 *   - plugins/{name}/plugin.json (backend.devPort)
 *
 * This is a local copy to avoid importing from @naap/plugin-sdk in
 * server-side API routes, which triggers barrel-export resolution
 * failures during the Next.js build on Vercel (the SDK barrel pulls
 * in hooks/components/types barrels that don't exist as compiled JS).
 */

export const PLUGIN_PORTS: Record<string, number> = {
  // Core services
  'base': 4000,
  'plugin-server': 3100,

  // Plugins (ports must match plugins/*/plugin.json → backend.devPort)
  'marketplace': 4005,
  'community': 4006,
  'plugin-publisher': 4010,
  'service-gateway': 4020,
};

/** Default port when plugin is not found */
export const DEFAULT_PORT = 4000;
