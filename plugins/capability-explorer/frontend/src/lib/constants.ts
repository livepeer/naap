import type { CapabilityCategory } from './types';

export const PIPELINE_COLORS: Record<string, string> = {
  't2i': '#f59e0b',
  'i2i': '#8b5cf6',
  'i2v': '#3b82f6',
  't2v': '#ec4899',
  'llm': '#a855f7',
  'a2t': '#06b6d4',
  'tts': '#14b8a6',
  'upscale': '#84cc16',
  'live-video': '#10b981',
  'other': '#6366f1',
};

export const CATEGORY_LABELS: Record<CapabilityCategory, string> = {
  llm: 'LLM',
  t2i: 'Text to Image',
  t2v: 'Text to Video',
  i2i: 'Image to Image',
  i2v: 'Image to Video',
  a2t: 'Audio to Text',
  tts: 'Text to Speech',
  upscale: 'Upscale',
  'live-video': 'Live Video',
  other: 'Other',
};

export const CATEGORY_SHORT_LABELS: Record<CapabilityCategory, string> = {
  llm: 'LLM',
  t2i: 'T2I',
  t2v: 'T2V',
  i2i: 'I2I',
  i2v: 'I2V',
  a2t: 'A2T',
  tts: 'TTS',
  upscale: 'Upscale',
  'live-video': 'Live',
  other: 'Other',
};

export const SORT_OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'gpuCount', label: 'GPU Count' },
  { value: 'price', label: 'Price' },
  { value: 'latency', label: 'Latency' },
  { value: 'capacity', label: 'Capacity' },
] as const;

export const ALL_CATEGORIES: CapabilityCategory[] = [
  'llm', 't2i', 't2v', 'i2i', 'i2v', 'a2t', 'tts', 'upscale', 'live-video', 'other',
];

export const PLACEHOLDER_THUMBNAILS: Record<CapabilityCategory, string> = {
  t2i: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" fill="%23f59e0b20"><rect width="200" height="200"/><text x="50%" y="50%" fill="%23f59e0b" font-size="48" text-anchor="middle" dy=".3em">T2I</text></svg>',
  i2i: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" fill="%238b5cf620"><rect width="200" height="200"/><text x="50%" y="50%" fill="%238b5cf6" font-size="48" text-anchor="middle" dy=".3em">I2I</text></svg>',
  i2v: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" fill="%233b82f620"><rect width="200" height="200"/><text x="50%" y="50%" fill="%233b82f6" font-size="48" text-anchor="middle" dy=".3em">I2V</text></svg>',
  t2v: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" fill="%23ec489920"><rect width="200" height="200"/><text x="50%" y="50%" fill="%23ec4899" font-size="48" text-anchor="middle" dy=".3em">T2V</text></svg>',
  llm: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" fill="%23a855f720"><rect width="200" height="200"/><text x="50%" y="50%" fill="%23a855f7" font-size="48" text-anchor="middle" dy=".3em">LLM</text></svg>',
  a2t: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" fill="%2306b6d420"><rect width="200" height="200"/><text x="50%" y="50%" fill="%2306b6d4" font-size="48" text-anchor="middle" dy=".3em">A2T</text></svg>',
  tts: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" fill="%2314b8a620"><rect width="200" height="200"/><text x="50%" y="50%" fill="%2314b8a6" font-size="48" text-anchor="middle" dy=".3em">TTS</text></svg>',
  upscale: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" fill="%2384cc1620"><rect width="200" height="200"/><text x="50%" y="50%" fill="%2384cc16" font-size="48" text-anchor="middle" dy=".3em">UP</text></svg>',
  'live-video': 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" fill="%2310b98120"><rect width="200" height="200"/><text x="50%" y="50%" fill="%2310b981" font-size="48" text-anchor="middle" dy=".3em">LIVE</text></svg>',
  other: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200" fill="%236366f120"><rect width="200" height="200"/><text x="50%" y="50%" fill="%236366f1" font-size="48" text-anchor="middle" dy=".3em">AI</text></svg>',
};
