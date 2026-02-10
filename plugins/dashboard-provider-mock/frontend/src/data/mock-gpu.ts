import type { DashboardGPUCapacity } from '@naap/plugin-sdk';

/** Mock GPU capacity data — the ONLY place this data exists in the codebase */
export const mockGPU: DashboardGPUCapacity = {
  totalGPUs: 384,
  availableCapacity: 61,
};
