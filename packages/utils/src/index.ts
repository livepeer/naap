// @naap/utils - Shared utility functions

// Re-export CSRF middleware for backend services
export * from './csrf.js';

// Re-export standardized API response format
export * from './response.js';

// Re-export input validation middleware
export * from './validation.js';

// Re-export Prometheus metrics utilities
export * from './metrics.js';

// Re-export feature flags and kill switch
export * from './featureFlags.js';

// Re-export error handling utilities
export * from './errorHandler.js';

// Re-export tracing infrastructure
export * from './tracing.js';

/**
 * Format an Ethereum address to a shortened display format
 */
export function formatAddress(address: string, chars = 4): string {
  if (!address) return '';
  return `${address.slice(0, chars + 2)}...${address.slice(-chars)}`;
}

/**
 * Format a number with locale-aware thousand separators
 */
export function formatNumber(value: number, decimals = 0): string {
  return value.toLocaleString(undefined, { 
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals 
  });
}

/**
 * Format ETH value with appropriate precision
 */
export function formatEth(wei: number): string {
  const eth = wei / 1e18;
  return eth.toFixed(4);
}

/**
 * Format a timestamp to relative time (e.g., "2h ago")
 */
export function formatRelativeTime(timestamp: string | Date): string {
  const now = new Date();
  const then = new Date(timestamp);
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

/**
 * Debounce a function
 */
export function debounce<T extends (...args: unknown[]) => void>(
  fn: T,
  delay: number
): (...args: Parameters<T>) => void {
  let timeoutId: ReturnType<typeof setTimeout>;
  return (...args: Parameters<T>) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), delay);
  };
}

/**
 * Deep clone an object
 */
export function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Generate a random ID
 */
export function generateId(prefix = ''): string {
  return `${prefix}${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Class names utility (simple version of clsx)
 */
export function cn(...classes: (string | undefined | null | false)[]): string {
  return classes.filter(Boolean).join(' ');
}
