/**
 * Dashboard Data Provider Contracts
 *
 * Shared contracts between core dashboard and provider plugins.
 * Both sides import from here to ensure type and schema alignment.
 */

// Schema, constants, and types
export {
  DASHBOARD_QUERY_EVENT,
  DASHBOARD_JOB_FEED_EVENT,
  DASHBOARD_JOB_FEED_EMIT_EVENT,
  DASHBOARD_SCHEMA,
  type MetricDelta,
  type DashboardKPI,
  type DashboardProtocol,
  type DashboardFeeEntry,
  type DashboardFeesInfo,
  type DashboardPipelineUsage,
  type DashboardGPUCapacity,
  type DashboardPipelinePricing,
  type DashboardData,
  type DashboardQueryRequest,
  type DashboardQueryResponse,
  type JobFeedSubscribeResponse,
  type JobFeedEntry,
  type DashboardResolvers,
} from './dashboard.js';

// Provider helper
export { createDashboardProvider, getDashboardSchema } from './createDashboardProvider.js';
