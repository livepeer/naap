/**
 * Telegram-webhook retry helper (PR 23).
 *
 * The webhook handler can fail mid-flight for two very different
 * reasons:
 *
 *   - Transient: an LLM provider timed out, a Postgres connection
 *     was reset by the pooler, a downstream cron blip. These almost
 *     always succeed on a retry; we want to lean in.
 *
 *   - Permanent: the LLM returned 4xx (bad prompt, quota exhausted,
 *     auth failure), the input is malformed, the user typed something
 *     we genuinely cannot understand. Retrying buys nothing and just
 *     piles cost / latency / dead-letter rows on top of a doomed call.
 *
 * `withRetry` wraps an async fn and attempts it up to `maxAttempts`
 * times, sleeping `backoffMs[i]` between attempts. The caller can pass
 * a custom `isTransient` classifier; otherwise we default to a
 * conservative regex that only treats explicit network/timeout errors
 * as transient. Anything else short-circuits on the first failure and
 * throws — so the caller can write a dead-letter row exactly once,
 * with the original error attached.
 *
 * Total attempts are capped at `min(maxAttempts, backoffMs.length + 1)`
 * — there's no way to retry more times than we have a sleep schedule
 * for, and silently uncapping invites runaways.
 */

import 'server-only';

export interface WithRetryOptions {
  /**
   * Maximum total attempts (initial call + retries). Default 3.
   * Capped at `backoffMs.length + 1` — you can only retry as many
   * times as you have a sleep schedule for.
   */
  maxAttempts?: number;
  /**
   * Sleep (in ms) between attempts. The first entry is the wait
   * after the first failure, the second entry the wait after the
   * second failure, etc. Default `[100, 500, 2000]` (~exponential).
   */
  backoffMs?: number[];
  /**
   * Classify whether an error is worth retrying. Returns `true` for
   * transient errors (retry) and `false` for permanent errors (give
   * up immediately). Default: only retries when the message matches
   * /timeout|ECONN|connect/i — a deliberately small set so we don't
   * mask real bugs.
   */
  isTransient?: (err: unknown) => boolean;
}

const DEFAULT_BACKOFF_MS = [100, 500, 2000] as const;
const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Default "is this transient?" classifier.
 *
 * Matches only on explicit network/timeout signals so we never
 * accidentally retry a 4xx. The set is small on purpose — this is the
 * fallback for callers that don't pass their own classifier; if you
 * need anything more nuanced, supply `isTransient` yourself.
 */
export function defaultIsTransient(err: unknown): boolean {
  if (!err) return false;
  const msg =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
      ? err
      : typeof err === 'object' && err !== null && 'message' in err
      ? String((err as { message: unknown }).message ?? '')
      : '';
  if (!msg) return false;
  return /timeout|ECONN|connect/i.test(msg);
}

/**
 * Run `fn` with exponential backoff. See module docs for retry policy.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: WithRetryOptions = {},
): Promise<T> {
  const backoff = opts.backoffMs ?? [...DEFAULT_BACKOFF_MS];
  const requested = opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  // Can't retry more than we have a sleep schedule for.
  const maxAttempts = Math.max(1, Math.min(requested, backoff.length + 1));
  const isTransient = opts.isTransient ?? defaultIsTransient;

  let lastErr: unknown;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      // Permanent errors short-circuit.
      if (!isTransient(err)) throw err;
      // Out of attempts — surface the last error.
      if (attempt === maxAttempts - 1) throw err;
      // Sleep, then loop.
      const wait = backoff[attempt] ?? backoff[backoff.length - 1] ?? 0;
      if (wait > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, wait));
      }
    }
  }
  // Unreachable, but TS wants a terminal throw.
  throw lastErr;
}
