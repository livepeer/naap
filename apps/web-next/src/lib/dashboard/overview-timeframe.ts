/**
 * Shared overview / dashboard timeframe options (hours as string values).
 * Used by Overview UI, public page localStorage allowlist, and /dashboard prefs.
 *
 * {@link OVERVIEW_TIMEFRAME_MAX_HOURS} caps the selector and BFF `timeframe` parsing for performance.
 */

export const OVERVIEW_TIMEFRAME_MAX_HOURS = 48 as const;

export const OVERVIEW_TIMEFRAME_OPTIONS = [
  { label: '1h', value: '1', description: 'Last hour' },
  { label: '6h', value: '6', description: 'Last 6 hours' },
  { label: '12h', value: '12', description: 'Last 12 hours' },
  { label: '18h', value: '18', description: 'Last 18 hours' },
  { label: '24h', value: '24', description: 'Last 24 hours' },
  { label: '48h', value: '48', description: 'Last 48 hours (max)' },
] as const;

export type OverviewTimeframeValue = (typeof OVERVIEW_TIMEFRAME_OPTIONS)[number]['value'];

export const OVERVIEW_TIMEFRAME_VALUES: readonly string[] = OVERVIEW_TIMEFRAME_OPTIONS.map(
  (o) => o.value,
);

export const DEFAULT_OVERVIEW_TIMEFRAME: OverviewTimeframeValue = '12';

export function formatOverviewTimeframeLabel(hours: number): string {
  if (hours === 1) return '1h';
  if (hours < 24) return `${hours}h`;
  if (hours % 24 === 0) return `${hours / 24}d`;
  const days = (hours / 24).toFixed(1);
  const trimmed = days.endsWith('.0') ? days.slice(0, -2) : days;
  return `${trimmed}d`;
}
