/**
 * Dashboard Provider Helper
 *
 * Reduces plugin boilerplate for becoming a dashboard data provider.
 * Builds the shared GraphQL schema once, wraps user-provided resolvers,
 * and registers a single event bus handler.
 *
 * @example
 * ```typescript
 * import { createDashboardProvider } from '@naap/plugin-sdk';
 *
 * const cleanup = createDashboardProvider(eventBus, {
 *   kpi: async () => ({ successRate: { value: 97, delta: 1 }, ... }),
 *   protocol: async () => ({ currentRound: 4127, ... }),
 *   // Only implement what your plugin provides
 * });
 *
 * // Call cleanup() on plugin unmount
 * ```
 */

import { buildSchema, graphql, type GraphQLSchema } from 'graphql';
import {
  DASHBOARD_SCHEMA,
  DASHBOARD_QUERY_EVENT,
  type DashboardResolvers,
  type DashboardQueryRequest,
  type DashboardQueryResponse,
} from './dashboard.js';
import type { IEventBus } from '../types/services.js';

// Cached schema instance — built once, reused across all calls
let cachedSchema: GraphQLSchema | null = null;

/**
 * Get or build the dashboard GraphQL schema.
 * The schema is built once and cached for the lifetime of the process.
 */
export function getDashboardSchema(): GraphQLSchema {
  if (!cachedSchema) {
    cachedSchema = buildSchema(DASHBOARD_SCHEMA);
  }
  return cachedSchema;
}

/**
 * Register as a dashboard data provider on the event bus.
 *
 * @param eventBus - The shell event bus instance
 * @param resolvers - Partial resolver map (implement only what you provide)
 * @returns A cleanup function that unregisters the handler
 */
export function createDashboardProvider(
  eventBus: IEventBus,
  resolvers: DashboardResolvers
): () => void {
  const schema = getDashboardSchema();

  // Build the root value object from user-provided resolvers.
  // GraphQL will return null for any root field not in this object.
  const rootValue: Record<string, unknown> = {};

  if (resolvers.kpi) {
    rootValue.kpi = (_args: { window?: string }) => resolvers.kpi!(_args);
  }
  if (resolvers.protocol) {
    rootValue.protocol = () => resolvers.protocol!();
  }
  if (resolvers.fees) {
    rootValue.fees = (_args: { days?: number }) => resolvers.fees!(_args);
  }
  if (resolvers.pipelines) {
    rootValue.pipelines = (_args: { limit?: number }) => resolvers.pipelines!(_args);
  }
  if (resolvers.gpuCapacity) {
    rootValue.gpuCapacity = () => resolvers.gpuCapacity!();
  }
  if (resolvers.pricing) {
    rootValue.pricing = () => resolvers.pricing!();
  }

  // Register a single handler on the event bus
  const unsubscribe = eventBus.handleRequest<DashboardQueryRequest, DashboardQueryResponse>(
    DASHBOARD_QUERY_EVENT,
    async (request: DashboardQueryRequest): Promise<DashboardQueryResponse> => {
      const result = await graphql({
        schema,
        source: request.query,
        rootValue,
        variableValues: request.variables,
      });

      return {
        data: (result.data as DashboardQueryResponse['data']) ?? null,
        errors: result.errors?.map((e) => ({
          message: e.message,
          path: e.path?.map(String),
        })),
      };
    }
  );

  return unsubscribe;
}
