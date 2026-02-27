/**
 * Pipeline display names and colors
 *
 * Maps the internal pipeline identifiers used by the leaderboard API
 * (e.g. "streamdiffusion-sdxl-v2v") to dashboard-friendly display names
 * and chart colors.
 *
 * A null display name means "exclude from the Top Pipelines chart".
 * Add new entries here as more pipelines come online on the network.
 */

export const PIPELINE_DISPLAY: Record<string, string | null> = {
  'streamdiffusion-sdxl':     'Image-to-Image',
  'streamdiffusion-sdxl-v2v': 'Video-to-Video',
  'noop':                     null,  // benchmark / health-check — not a real workload
};

export const PIPELINE_COLOR: Record<string, string> = {
  'streamdiffusion-sdxl':     '#8b5cf6',  // violet
  'streamdiffusion-sdxl-v2v': '#10b981',  // emerald
};

/** Fallback color for pipelines not listed above */
export const DEFAULT_PIPELINE_COLOR = '#6366f1';
