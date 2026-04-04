/**
 * Shared dark theme config for recharts
 */

export const CHART_COLORS = {
  reward: '#34d399',    // emerald-400
  fee: '#a78bfa',       // purple-400
  combined: '#60a5fa',  // blue-400
  grid: 'rgba(255,255,255,0.06)',
  text: 'rgba(255,255,255,0.5)',
  tooltip: 'rgba(0,0,0,0.85)',
} as const;

export const CHART_STYLE = {
  fontFamily: '"SF Mono", "Fira Code", monospace',
  fontSize: 11,
} as const;
