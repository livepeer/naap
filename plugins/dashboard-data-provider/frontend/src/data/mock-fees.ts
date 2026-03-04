import type { DashboardFeesInfo } from '@naap/plugin-sdk';

/** Mock fees data — used as fallback when subgraph is unavailable */
export const mockFees: DashboardFeesInfo = {
  totalEth: 102.4,
  totalUsd: 250000,
  oneDayVolumeUsd: 1200,
  oneDayVolumeEth: 0.5,
  oneWeekVolumeUsd: 8400,
  oneWeekVolumeEth: 3.5,
  volumeChangeUsd: 5.2,
  volumeChangeEth: 4.8,
  weeklyVolumeChangeUsd: 3.1,
  weeklyVolumeChangeEth: 2.9,
  dayData: [
    { dateS: 1709078400, volumeEth: 0.45, volumeUsd: 1080 },
    { dateS: 1709164800, volumeEth: 0.52, volumeUsd: 1248 },
    { dateS: 1709251200, volumeEth: 0.48, volumeUsd: 1152 },
    { dateS: 1709337600, volumeEth: 0.61, volumeUsd: 1464 },
    { dateS: 1709424000, volumeEth: 0.55, volumeUsd: 1320 },
    { dateS: 1709510400, volumeEth: 0.38, volumeUsd: 912 },
    { dateS: 1709596800, volumeEth: 0.50, volumeUsd: 1200 },
  ],
  weeklyData: [
    { date: 1709078400, weeklyVolumeUsd: 8400, weeklyVolumeEth: 3.49 },
  ],
};
