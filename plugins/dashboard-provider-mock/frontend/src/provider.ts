/**
 * Mock Dashboard Provider
 *
 * Registers as the dashboard data provider using createDashboardProvider()
 * from the SDK. Serves mock data for all widget types.
 *
 * To create a real provider, replace the mock data imports with
 * actual API calls or database queries.
 */

import {
  createDashboardProvider,
  type IEventBus,
} from '@naap/plugin-sdk';
import {
  mockKPI,
  mockProtocol,
  mockFees,
  mockPipelines,
  mockGPU,
  mockPricing,
} from './data/index.js';

/**
 * Register the mock dashboard data provider on the event bus.
 *
 * @param eventBus - The shell event bus instance
 * @returns Cleanup function to call on plugin unmount
 */
export function registerMockDashboardProvider(eventBus: IEventBus): () => void {
  return createDashboardProvider(eventBus, {
    kpi: async () => mockKPI,
    protocol: async () => mockProtocol,
    fees: async () => mockFees,
    pipelines: async () => mockPipelines,
    gpuCapacity: async () => mockGPU,
    pricing: async () => mockPricing,
  });
}
