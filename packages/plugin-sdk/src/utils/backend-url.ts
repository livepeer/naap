/**
 * Backend URL Resolution Utilities
 * 
 * Provides utilities to resolve plugin backend URLs automatically based on:
 * - Plugin manifest deployment information
 * - Environment variables
 * - Development mode conventions
 */

/**
 * Get the backend URL for a specific plugin.
 * 
 * Resolution order:
 * 1. Environment variable: `VITE_${PLUGIN_NAME}_BACKEND_URL` or `REACT_APP_${PLUGIN_NAME}_BACKEND_URL`
 * 2. Plugin deployment info from shell context (production)
 * 3. Development convention: `http://localhost:${basePort + pluginIndex}`
 * 
 * @param pluginName - The name of the plugin (e.g., 'my-wallet', 'marketplace')
 * @param options - Configuration options
 * @returns The backend URL for the plugin
 * 
 * @example
 * ```typescript
 * // In development, returns http://localhost:4008 for my-wallet
 * const url = getBackendUrl('my-wallet');
 * 
 * // With custom base port
 * const url = getBackendUrl('my-wallet', { basePort: 5000 });
 * 
 * // From environment variable
 * // VITE_MY_WALLET_BACKEND_URL=https://api.example.com
 * const url = getBackendUrl('my-wallet'); // returns https://api.example.com
 * ```
 */
export function getBackendUrl(
  pluginName: string,
  options?: {
    /** Base port for development mode (default: 4000) */
    basePort?: number;
    /** Plugin manifest with deployment info (for production) */
    deploymentUrl?: string | null;
  }
): string {
  const { basePort = 4000, deploymentUrl } = options || {};

  // 1. Check environment variables first (highest priority)
  if (typeof window !== 'undefined' && (window as any).env) {
    const env = (window as any).env;
    const envKey = pluginName.toUpperCase().replace(/-/g, '_');
    
    // Check Vite convention
    const viteUrl = env[`VITE_${envKey}_BACKEND_URL`];
    if (viteUrl) return viteUrl;
    
    // Check Create React App convention
    const craUrl = env[`REACT_APP_${envKey}_BACKEND_URL`];
    if (craUrl) return craUrl;
  }

  // Node.js environment variables
  if (typeof process !== 'undefined' && process.env) {
    const envKey = pluginName.toUpperCase().replace(/-/g, '_');
    const nodeUrl = process.env[`${envKey}_BACKEND_URL`];
    if (nodeUrl) return nodeUrl;
  }

  // 2. Use deployment URL from plugin manifest (production)
  if (deploymentUrl) {
    return deploymentUrl;
  }

  // 3. Production / deployed environments: use same-origin (no port).
  //    On Vercel (or any non-localhost deployment) plugin backends don't
  //    run as separate services — all API traffic goes through the
  //    Next.js API proxy on the same origin.
  if (typeof window !== 'undefined') {
    const hostname = window.location.hostname;
    if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
      return '';  // same-origin, paths only
    }
  }

  // 4. Development convention: use predictable port based on plugin name
  // This matches the common pattern where plugins use sequential ports
  const pluginPort = getPluginPort(pluginName, basePort);
  
  if (typeof window !== 'undefined') {
    return `${window.location.protocol}//${window.location.hostname}:${pluginPort}`;
  }
  
  return `http://localhost:${pluginPort}`;
}

/**
 * Get the API base URL (full path including /api/v1/...)
 * 
 * @param pluginName - The name of the plugin
 * @param options - Configuration options
 * @returns The full API URL with path
 * 
 * @example
 * ```typescript
 * const apiUrl = getApiUrl('my-wallet');
 * // Returns: http://localhost:4008/api/v1/wallet
 * ```
 */
export function getApiUrl(
  pluginName: string,
  options?: {
    basePort?: number;
    deploymentUrl?: string | null;
    /** API path suffix (default: /api/v1/{pluginName}) */
    apiPath?: string;
  }
): string {
  const { apiPath, ...backendOptions } = options || {};
  const baseUrl = getBackendUrl(pluginName, backendOptions);
  
  // Use custom API path if provided, otherwise use convention
  const path = apiPath || `/api/v1/${pluginName}`;
  
  return `${baseUrl}${path}`;
}

/**
 * Calculate plugin port based on plugin name.
 * Uses a simple hash to get consistent ports for the same plugin names.
 * 
 * @param pluginName - The name of the plugin
 * @param basePort - Base port number (default: 4000)
 * @returns Port number for the plugin
 */
function getPluginPort(pluginName: string, basePort: number = 4000): number {
  // Known plugin ports (hardcoded for common plugins)
  const knownPorts: Record<string, number> = {
    'base': 4000,
    'gateway-manager': 4001,
    'marketplace': 4002,
    'developer': 4003,
    'plugin-publisher': 4004,
    'orchestrator-manager': 4005,
    'network-analytics': 4006,
    'capacity-planner': 4007,
    'my-wallet': 4008,
    'my-dashboard': 4009,
    'community': 4010,
  };

  if (knownPorts[pluginName]) {
    return knownPorts[pluginName];
  }

  // For unknown plugins, use a simple hash to get a consistent port
  let hash = 0;
  for (let i = 0; i < pluginName.length; i++) {
    hash = ((hash << 5) - hash) + pluginName.charCodeAt(i);
    hash = hash & hash; // Convert to 32bit integer
  }
  
  // Use hash to get a port between basePort+100 and basePort+999
  const offset = Math.abs(hash % 900) + 100;
  return basePort + offset;
}

/**
 * Get CSRF token from storage or meta tags
 * 
 * @returns CSRF token or null if not found
 */
export function getCsrfToken(): string | null {
  // Check session storage first
  if (typeof window !== 'undefined') {
    const sessionToken = sessionStorage.getItem('naap_csrf_token');
    if (sessionToken) return sessionToken;

    // Check localStorage as fallback
    const localToken = localStorage.getItem('csrf_token');
    if (localToken) return localToken;

    // Check meta tag
    const metaTag = document.querySelector('meta[name="csrf-token"]');
    if (metaTag) {
      return metaTag.getAttribute('content');
    }
  }

  return null;
}

/**
 * Generate a correlation ID for request tracing
 * 
 * @returns A unique correlation ID
 */
export function generateCorrelationId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}
