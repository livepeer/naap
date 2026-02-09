/**
 * Plugin port configuration for the API proxy route.
 *
 * These ports must match the values in:
 *   - packages/plugin-sdk/src/config/ports.ts (PLUGIN_PORTS)
 *   - plugins/*/plugin.json → backend.devPort
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

  // Core plugins (ports must match plugins/*/plugin.json → backend.devPort)
  'gateway-manager': 4001,
  'orchestrator-manager': 4002,
  'capacity-planner': 4003,
  'network-analytics': 4004,
  'marketplace': 4005,
  'community': 4006,
  'developer-api': 4007,
  'my-wallet': 4008,
  'my-dashboard': 4009,
  'plugin-publisher': 4010,

  // Extended plugins (4100+)
  'daydream-video': 4111,
};

/** Default port when plugin is not found */
export const DEFAULT_PORT = 4000;
