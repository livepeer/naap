import type { DashboardFeesInfo } from '@naap/plugin-sdk';

/** Mock fees data — the ONLY place this data exists in the codebase */
export const mockFees: DashboardFeesInfo = {
  totalEth: 102.4,
  entries: [
    { day: 'Mon', eth: 12.4 },
    { day: 'Tue', eth: 15.1 },
    { day: 'Wed', eth: 14.8 },
    { day: 'Thu', eth: 18.3 },
    { day: 'Fri', eth: 16.9 },
    { day: 'Sat', eth: 11.2 },
    { day: 'Sun', eth: 13.7 },
  ],
};
