import type { DashboardKPI } from '@naap/plugin-sdk';

/** Mock KPI data — the ONLY place this data exists in the codebase */
export const mockKPI: DashboardKPI = {
  successRate: { value: 97.3, delta: 1.2 },
  orchestratorsOnline: { value: 142, delta: 8 },
  dailyUsageMins: { value: 48720, delta: 3200 },
  dailyStreamCount: { value: 1843, delta: -47 },
};
