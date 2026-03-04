import type { DashboardFeesInfo } from '@naap/plugin-sdk';

/** Mock fees data — the ONLY place this data exists in the codebase */
export const mockFees: DashboardFeesInfo = {
  totalEth: 102.4,
  totalUsd: 244_890,
  oneDayVolumeUsd: 36_200,
  oneDayVolumeEth: 13.7,
  oneWeekVolumeUsd: 131_100,
  oneWeekVolumeEth: 45.3,
  volumeChangeUsd: 7.5,
  volumeChangeEth: 6.2,
  weeklyVolumeChangeUsd: 12.3,
  weeklyVolumeChangeEth: 10.8,
  dayData: [
    { dateS: 1761523200, volumeEth: 12.4, volumeUsd: 31_200 },
    { dateS: 1761609600, volumeEth: 15.1, volumeUsd: 37_800 },
    { dateS: 1761696000, volumeEth: 14.8, volumeUsd: 35_900 },
    { dateS: 1761782400, volumeEth: 18.3, volumeUsd: 45_600 },
    { dateS: 1761868800, volumeEth: 16.9, volumeUsd: 42_100 },
    { dateS: 1761955200, volumeEth: 11.2, volumeUsd: 28_700 },
    { dateS: 1762041600, volumeEth: 13.7, volumeUsd: 36_200 },
  ],
  weeklyData: [
    { date: 1760918400, weeklyVolumeEth: 40.9, weeklyVolumeUsd: 118_900 },
    { date: 1761523200, weeklyVolumeEth: 45.3, weeklyVolumeUsd: 131_100 },
  ],
};
