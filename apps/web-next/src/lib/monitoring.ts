/**
 * Structured error reporting.
 *
 * Use `reportError` for failures that should trigger alerts/observability.
 * Behavior:
 *  - Always emits a structured JSON line tagged `[ALERT]` so Vercel Log Drains
 *    (Datadog, Logflare, etc.) can pattern-match for alerting today.
 *  - If `@sentry/nextjs` is installed and `SENTRY_DSN` is set, additionally
 *    forwards the exception to `Sentry.captureException`. The Sentry SDK is
 *    loaded via dynamic import so the dependency stays optional; no-op when
 *    absent.
 *
 * This is intentionally lightweight: it standardizes the "swallow + log" spots
 * that have historically hidden production regressions (e.g. silent verification
 * email failures) without requiring the full Sentry SDK to be wired up.
 */

const ALERT_TAG = '[ALERT]';

export interface ErrorContext {
  /** Logical area of the codebase (e.g. 'auth.email.verification'). */
  area: string;
  /** Free-form tags for filtering in your log/alert backend. */
  tags?: Record<string, string | number | boolean | undefined>;
  /** Extra structured fields (must be JSON-serializable). */
  extra?: Record<string, unknown>;
}

interface SentryLike {
  captureException: (err: unknown, hint?: { tags?: Record<string, unknown>; extra?: Record<string, unknown> }) => void;
}

let _sentry: SentryLike | null | undefined;

async function loadSentry(): Promise<SentryLike | null> {
  if (_sentry !== undefined) return _sentry;
  if (!process.env.SENTRY_DSN) {
    _sentry = null;
    return _sentry;
  }
  // Resolve via a dynamic specifier so TypeScript does not require the
  // optional `@sentry/nextjs` package to be installed at build time. The
  // dependency is intentionally optional; this PR keeps the surface area
  // small while leaving a hook for a follow-up Sentry SDK install.
  const SENTRY_MODULE = '@sentry/nextjs';
  try {
    const mod = (await import(/* webpackIgnore: true */ SENTRY_MODULE).catch(() => null)) as
      | { captureException?: SentryLike['captureException'] }
      | null;
    if (mod && typeof mod.captureException === 'function') {
      _sentry = { captureException: mod.captureException };
    } else {
      _sentry = null;
    }
  } catch {
    _sentry = null;
  }
  return _sentry;
}

/**
 * Sanitize string fields for log output (strip control chars that enable
 * log injection / display corruption).
 */
function sanitize(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(/[\n\r\t\x00-\x1f\x7f-\x9f\u2028\u2029]/g, ' ');
  }
  return value;
}

function buildLogPayload(err: unknown, ctx: ErrorContext): Record<string, unknown> {
  const e = err instanceof Error ? err : new Error(String(err));
  const sanitizedTags: Record<string, unknown> = {};
  if (ctx.tags) {
    for (const [k, v] of Object.entries(ctx.tags)) {
      sanitizedTags[k] = sanitize(v);
    }
  }
  return {
    level: 'error',
    area: ctx.area,
    name: e.name,
    message: sanitize(e.message),
    stack: e.stack,
    tags: sanitizedTags,
    extra: ctx.extra,
    env: process.env.VERCEL_ENV || process.env.NODE_ENV || 'unknown',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Report an error: emits a structured log line and forwards to Sentry when
 * available. Never throws — failures here must not break the caller.
 */
export function reportError(err: unknown, ctx: ErrorContext): void {
  try {
    const payload = buildLogPayload(err, ctx);
    console.error(`${ALERT_TAG} ${JSON.stringify(payload)}`);
  } catch {
    // Last-ditch fallback if JSON serialization fails
    console.error(`${ALERT_TAG} reportError serialization failure in area=${ctx.area}`);
  }

  // Forward to Sentry without awaiting; failures must not propagate.
  void loadSentry()
    .then((sentry) => {
      if (!sentry) return;
      try {
        sentry.captureException(err, { tags: ctx.tags, extra: ctx.extra });
      } catch {
        // Sentry failure is non-critical
      }
    })
    .catch(() => {
      /* swallow */
    });
}

/** Internal hook for tests. */
export function __resetMonitoringForTests(): void {
  _sentry = undefined;
}
