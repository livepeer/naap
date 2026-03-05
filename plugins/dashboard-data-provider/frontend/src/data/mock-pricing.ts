import type { DashboardPipelinePricing } from '@naap/plugin-sdk';

/** Mock pipeline pricing data — the ONLY place this data exists in the codebase */
export const mockPricing: DashboardPipelinePricing[] = [
  { pipeline: 'Text-to-Image', unit: 'image', price: 0.004, outputPerDollar: '250 images' },
  { pipeline: 'Image-to-Video', unit: 'second', price: 0.05, outputPerDollar: '20 seconds' },
  { pipeline: 'Video-to-Video', unit: 'minute', price: 0.12, outputPerDollar: '8.3 minutes' },
  { pipeline: 'Upscale', unit: 'image', price: 0.008, outputPerDollar: '125 images' },
  { pipeline: 'Audio-to-Text', unit: 'minute', price: 0.006, outputPerDollar: '166 minutes' },
  { pipeline: 'Segment Anything 2', unit: 'image', price: 0.005, outputPerDollar: '200 images' },
  { pipeline: 'LLM', unit: '1K tokens', price: 0.0002, outputPerDollar: '5M tokens' },
];
