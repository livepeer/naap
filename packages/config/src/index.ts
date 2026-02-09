// @naap/config - Shared configuration

export const config = {
  // API endpoints
  api: {
    baseUrl: import.meta.env.VITE_API_URL || 'http://localhost:4000',
    version: 'v1',
  },
  
  // App metadata
  app: {
    name: 'Livepeer Network Monitor',
    version: '0.0.1',
  },
  
  // Feature flags
  features: {
    enableMockData: import.meta.env.VITE_MOCK_DATA !== 'false',
    enableAuth: import.meta.env.VITE_ENABLE_AUTH === 'true',
  },
  
  // Workflow ports for local development
  ports: {
    shell: 3000,
    gatewayManager: 3001,
    orchestratorManager: 3002,
    capacityPlanner: 3003,
    networkAnalytics: 3004,
    marketplace: 3005,
    community: 3006,
  },
  
  // Service ports
  servicePorts: {
    base: 4000,
    gatewayManager: 4001,
    orchestratorManager: 4002,
    capacityPlanner: 4003,
    networkAnalytics: 4004,
    marketplace: 4005,
    community: 4006,
  },
} as const;

export type Config = typeof config;

/**
 * Get API endpoint for a workflow
 */
export function getApiUrl(workflow: string, path: string): string {
  return `${config.api.baseUrl}/api/${config.api.version}/${workflow}${path}`;
}

/**
 * Get CDN bundle URL for a plugin
 * @deprecated Use bundleUrl from plugin manifest instead
 */
export function getRemoteUrl(workflow: string, _port: number): string {
  return `/cdn/plugins/${workflow}/1.0.0/${workflow}.js`;
}
