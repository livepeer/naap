/**
 * Single-flight deduplication and short-TTL cache for async operations.
 *
 * Prevents request storms by:
 * 1. **Single-flight**: Concurrent calls with the same key share one in-flight promise.
 * 2. **TTL cache**: Resolved values are cached for a short window (configurable).
 * 3. **Bounded retry**: Failed requests are retried with exponential backoff + jitter.
 *
 * All state is module-scoped so every hook instance in the same page shares
 * the same dedup/cache layer.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

interface SingleFlightOptions {
  /** Cache TTL in ms.  Set 0 to disable caching (dedup still applies). Default: 1500ms in dev, 0 in prod. */
  ttlMs?: number;
  /** Max retries on network/server errors.  Default: 2. */
  maxRetries?: number;
  /** Base delay for exponential backoff in ms.  Default: 500. */
  baseDelayMs?: number;
  /** Hard ceiling on total retry delay in ms.  Default: 5000. */
  maxDelayMs?: number;
}

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

const inFlight = new Map<string, Promise<unknown>>();
const cache = new Map<string, CacheEntry<unknown>>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function jitter(base: number): number {
  // ±25% jitter
  return base * (0.75 + Math.random() * 0.5);
}

function isRetryable(err: unknown): boolean {
  if (!err) return false;
  // Network errors (TypeError: Failed to fetch)
  if (err instanceof TypeError) return true;
  // ApiError-shaped objects with status
  const status = (err as { status?: number }).status;
  if (typeof status === 'number') {
    // Retry on 429, 500, 502, 503, 504
    return status === 429 || (status >= 500 && status <= 504);
  }
  return false;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Execute `fn` with single-flight deduplication and optional TTL caching.
 *
 * @param key   Unique cache/dedup key (e.g. "config:marketplace:personal:")
 * @param fn    The async work to perform.  Receives an `AbortSignal` for cancellation.
 * @param opts  Caching and retry options.
 * @returns     The resolved value (possibly from cache or a shared in-flight promise).
 */
export async function singleFlight<T>(
  key: string,
  fn: (signal: AbortSignal) => Promise<T>,
  opts: SingleFlightOptions = {},
): Promise<T> {
  const isDev = typeof process !== 'undefined' && process.env?.NODE_ENV !== 'production';
  const {
    ttlMs = isDev ? 1500 : 0,
    maxRetries = 2,
    baseDelayMs = 500,
    maxDelayMs = 5000,
  } = opts;

  // 1. Check cache
  if (ttlMs > 0) {
    const cached = cache.get(key) as CacheEntry<T> | undefined;
    if (cached && cached.expiresAt > Date.now()) {
      return cached.value;
    }
  }

  // 2. Check in-flight
  const existing = inFlight.get(key) as Promise<T> | undefined;
  if (existing) {
    return existing;
  }

  // 3. Execute with retry
  const controller = new AbortController();

  const execute = async (): Promise<T> => {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (controller.signal.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      try {
        return await fn(controller.signal);
      } catch (err) {
        lastErr = err;
        // Don't retry if aborted
        if (controller.signal.aborted) throw err;
        // Don't retry on non-retryable errors
        if (!isRetryable(err) || attempt === maxRetries) throw err;
        // Exponential backoff with jitter
        const delay = Math.min(jitter(baseDelayMs * 2 ** attempt), maxDelayMs);
        await sleep(delay);
      }
    }
    throw lastErr;
  };

  const promise = execute()
    .then((value) => {
      // Populate cache
      if (ttlMs > 0) {
        cache.set(key, { value, expiresAt: Date.now() + ttlMs });
      }
      return value;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

/**
 * Invalidate a cached entry by key (e.g. after a config write).
 */
export function invalidateCache(key: string): void {
  cache.delete(key);
}

/**
 * Build a standard config cache key.
 */
export function configCacheKey(
  pluginName: string,
  scope: string,
  teamId?: string | null,
): string {
  return `config:${pluginName}:${scope}:${teamId ?? ''}`;
}
