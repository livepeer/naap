import type { DashboardPipelineUsage } from '@naap/plugin-sdk';

/** Mock pipeline usage data — the ONLY place this data exists in the codebase */
export const mockPipelines: DashboardPipelineUsage[] = [
  { name: 'Text-to-Image', mins: 14200, color: '#8b5cf6' },
  { name: 'Image-to-Video', mins: 11300, color: '#06b6d4' },
  { name: 'Video-to-Video', mins: 9800, color: '#10b981' },
  { name: 'Upscale', mins: 7100, color: '#f59e0b' },
  { name: 'Audio-to-Text', mins: 5400, color: '#ef4444' },
];
