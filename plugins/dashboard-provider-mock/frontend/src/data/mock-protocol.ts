import type { DashboardProtocol } from '@naap/plugin-sdk';

/** Mock protocol data — the ONLY place this data exists in the codebase */
export const mockProtocol: DashboardProtocol = {
  currentRound: 4127,
  blockProgress: 4152,
  totalBlocks: 5760,
  totalStakedLPT: 31_245_890,
};
