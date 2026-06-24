/**
 * Catalog + subscription domain logic (NAAP P3, developer-facing surface).
 *
 * DB-free request parsing + view-model shaping for the catalog / subscription
 * endpoints, so the rules can be unit-tested in isolation; the HTTP routes
 * persist rows and delegate the shaping here. Never emits secrets — a
 * `ProviderInstance` exposes only its public identity (slug/displayName/
 * adapterType), never `config`/`secretRef`.
 *
 * Everything here is reachable only when `multi_subscription` is ON (the routes
 * 404 when OFF), so this is purely additive — today's single-app dashboard and
 * the existing seat/key routes are untouched.
 */

export const SUBSCRIPTION_STATUS_ACTIVE = 'active';
export const SUBSCRIPTION_STATUS_CANCELED = 'canceled';
export const SUBSCRIPTION_STATUS_PAUSED = 'paused';

/** Statuses a caller may transition a subscription FROM via cancel. */
const CANCELABLE_STATUSES = new Set<string>([
  SUBSCRIPTION_STATUS_ACTIVE,
  SUBSCRIPTION_STATUS_PAUSED,
]);

/** True when a subscription in this status can still be canceled. */
export function isCancelableStatus(status: string): boolean {
  return CANCELABLE_STATUSES.has(status);
}

/** Minimal `ProviderInstance` row the catalog needs (NON-secret fields only). */
export interface CatalogInstanceRow {
  id: string;
  slug: string;
  displayName: string;
  adapterType: string;
  enabled: boolean;
  sortOrder: number;
}

/** A plan a developer can subscribe to (stubbed until P4 plan-spec sync). */
export interface CatalogPlanView {
  providerPlanId: string;
  name: string;
  capabilities: string[];
}

/** A catalog entry: one provider instance + the plans available on it. */
export interface CatalogInstanceView {
  providerInstanceId: string;
  slug: string;
  displayName: string;
  adapterType: string;
  plans: CatalogPlanView[];
}

/**
 * Map a `ProviderInstance` row to its catalog view. Plans are intentionally
 * empty in P3 — the synced `ProviderPlan` model + plan-spec pull land in P4; the
 * catalog "exposes what exists", which today is the instances themselves. Only
 * non-secret identity fields are surfaced (never `config`/`secretRef`).
 */
export function toCatalogInstanceView(
  instance: CatalogInstanceRow,
  plans: CatalogPlanView[] = [],
): CatalogInstanceView {
  return {
    providerInstanceId: instance.id,
    slug: instance.slug,
    displayName: instance.displayName,
    adapterType: instance.adapterType,
    plans,
  };
}

/** Minimal `Subscription` row the API surfaces. */
export interface SubscriptionRow {
  id: string;
  teamId: string;
  providerInstanceId: string;
  providerPlanId: string | null;
  accountId: string;
  status: string;
  appId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Provider-neutral subscription view (no secrets; opaque accountId retained). */
export interface SubscriptionView {
  id: string;
  providerInstanceId: string;
  providerPlanId: string | null;
  accountId: string;
  status: string;
  appId: string | null;
  createdAt: string;
  updatedAt: string;
}

export function toSubscriptionView(row: SubscriptionRow): SubscriptionView {
  return {
    id: row.id,
    providerInstanceId: row.providerInstanceId,
    providerPlanId: row.providerPlanId,
    accountId: row.accountId,
    status: row.status,
    appId: row.appId,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** Parsed, validated create-subscription request. */
export interface CreateSubscriptionInput {
  providerInstanceId: string;
  providerPlanId: string | null;
  /** Caller-supplied provider account pointer; null ⇒ derive from team binding. */
  accountId: string | null;
  appId: string | null;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

function optionalTrimmed(value: unknown, max = 256): string | null {
  if (value == null) return null;
  if (typeof value !== 'string') return null;
  const v = value.trim();
  if (v === '') return null;
  return v.slice(0, max);
}

/**
 * Validate a create-subscription body. `providerInstanceId` is required;
 * `providerPlanId`, `accountId`, and `appId` are optional. Returns a typed
 * error string (never throws) so the route can 400 with a clear message.
 */
export function parseCreateSubscriptionBody(body: unknown): ParseResult<CreateSubscriptionInput> {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Request body must be a JSON object' };
  }
  const b = body as Record<string, unknown>;
  const providerInstanceId = optionalTrimmed(b.providerInstanceId);
  if (!providerInstanceId) {
    return { ok: false, error: 'providerInstanceId is required' };
  }
  return {
    ok: true,
    value: {
      providerInstanceId,
      providerPlanId: optionalTrimmed(b.providerPlanId),
      accountId: optionalTrimmed(b.accountId),
      appId: optionalTrimmed(b.appId),
    },
  };
}
