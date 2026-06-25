/**
 * Known feature flags and their defaults.
 *
 * To add a new feature flag, append an entry here. It will:
 *  - Auto-create in the database on first API access (no re-seed required)
 *  - Appear on the admin Settings page automatically
 *  - Be available via useFeatureFlags() hook as flags.<key>
 */

import { prisma } from '@/lib/db';

export interface KnownFlag {
  key: string;
  enabled: boolean;
  description: string;
}

/**
 * Canonical key for the NAAP-5 flag (default OFF). Single source of truth shared
 * by the KNOWN_FLAGS registry and the gateway authorize step so the flag name
 * cannot silently drift between the two.
 */
export const SDK_CONNECTOR_FLAG = 'sdk_connector';

/**
 * Canonical key for the pymthouse BPP ② live capability-resolution flag (default
 * OFF). When OFF, `PymthouseAdapter.validate()` throws `AdapterNotImplementedError`
 * exactly as before, so the front door falls back to an empty capability set
 * (today's behavior). Shared by KNOWN_FLAGS and the adapter so the name cannot
 * drift. Requires the provider's `BPP_VALIDATE_V2` posture in the same env.
 */
export const PYMTHOUSE_BPP_VALIDATE_FLAG = 'pymthouse_bpp_validate';

/**
 * Canonical key for the multi-app `ProviderInstance` foundation (P0, default
 * OFF). When OFF, billing-provider resolution falls back to the global
 * `PYMTHOUSE_*` env single-app path EXACTLY as today (zero regression) and the
 * `ProviderInstance` table is never read. When ON, the adapter registry can
 * resolve a per-`ProviderInstance` adapter built from that instance's non-secret
 * `config` + a `secretRef` → `SecretVault` M2M secret, so multiple pymthouse
 * apps can coexist. Shared by KNOWN_FLAGS and the registry so the name cannot
 * drift.
 */
export const PROVIDER_INSTANCES_FLAG = 'provider_instances';

/**
 * Canonical key for the multi-subscription model (P1, default OFF). When OFF, a
 * key resolves via today's `key → team → single billingAccountRef` path and the
 * `Subscription` table is never consulted (zero regression). When ON, a key
 * MAY carry a `DevApiKey.subscriptionId` and resolution can hop through the
 * subscription (the per-key resolution wiring itself lands in a later phase).
 * Shared by KNOWN_FLAGS and the subscription resolver so the name cannot drift.
 */
export const MULTI_SUBSCRIPTION_FLAG = 'multi_subscription';

/**
 * Canonical key for the plan-spec → per-app discovery sync (P4, Deliverable 2,
 * default OFF). When OFF, the `ProviderPlan` table is never read or written, no
 * sync runs, the catalog exposes no plans, and discovery is EXACTLY today's
 * static `storyboard-default` / manual behavior (golden-set parity, zero
 * regression). When ON, a per-`ProviderInstance` pull upserts `ProviderPlan`
 * rows and auto-generates per-app `DiscoveryPlan`s, and the validate front door
 * may expose the per-key discovery URL (key → subscription → ProviderPlan →
 * DiscoveryPlan). Shared by KNOWN_FLAGS and the sync/discovery resolver so the
 * name cannot drift.
 */
export const PLAN_SPEC_SYNC_FLAG = 'plan_spec_sync';

/**
 * Canonical key for per-key remote-signer wiring (default OFF). When OFF the
 * validation front door returns the signer session EXACTLY as today — the
 * provider token-bundle form (`SignerSessionToken`, `pmth_…`) — and no extra
 * provider I/O happens (zero regression). When ON, and the resolved adapter
 * implements `resolveSignerEndpoint`, the front door instead returns the
 * `SignerSession` ENDPOINT form `{ url, headers }` pointing at the provider's
 * per-key remote signer DMZ (pymthouse: `getSignerRouting()` DMZ URL + the
 * minted `pmth_…` session as the `Authorization` header), so the SDK service
 * signs + pays through the funded per-key wallet instead of a static shared
 * signer. Mirrors the `DISCOVERY_FROM_VALIDATE` pattern: additive, flag-gated,
 * canary-only. Shared by KNOWN_FLAGS and the front door so the name cannot
 * drift. Pairs with simple-infra `SIGNER_FROM_VALIDATE` (the SDK service only
 * consumes the endpoint form when ITS flag is on).
 */
export const PER_KEY_REMOTE_SIGNER_FLAG = 'per_key_remote_signer';

export const KNOWN_FLAGS: KnownFlag[] = [
  {
    key: 'enableTeams',
    enabled: true,
    description: 'Enable teams collaboration feature (team creation, team switching, team pages)',
  },
  {
    key: 'provider_adapters',
    enabled: false,
    description:
      'Route billing requests through the generic BillingProviderAdapter registry (/api/v1/billing/{provider}/*). OFF = legacy /billing/pymthouse/* behavior only.',
  },
  {
    key: 'team_seats',
    enabled: false,
    description:
      'Team Seats API + provider-agnostic billingAccountRef binding (/api/v1/teams/{id}/seats/*, /billing-account). OFF = endpoints 404, no-op (NAAP-1).',
  },
  {
    key: 'usage_ingest',
    enabled: false,
    description:
      'Enable cross-provider usage telemetry: the BPP ⑥ ingest endpoint (/api/v1/metrics/ingest) and the spend dashboard BFF (/api/v1/metrics/usage). OFF = both return 404 (no-op).',
  },
  {
    key: 'usage_pull',
    enabled: false,
    description:
      'Spend dashboard PULLS provider usage live via the provider adapter (e.g. pymthouse M2M client) instead of reading pushed ProviderUsageRecord rows. OFF = reads ProviderUsageRecord exactly as today. ON = pull-first with graceful fallback to ProviderUsageRecord on any pull failure (never 500). Tenant scoping is preserved either way (NAAP-2).',
  },
  {
    key: 'app_registry',
    enabled: false,
    description:
      'Enable the application/service registry (/api/v1/apps/*) so usage and rate limits attribute per registered app. OFF = registry endpoints return 404 (no-op).',
  },
  {
    key: 'db_adapter_registry',
    enabled: false,
    description:
      'Resolve the BillingProviderAdapter from the BillingProvider.adapterType DB column (NAAP-A-db) instead of the static slug→adapter map. OFF = static registry (zero regression); falls back to static on any DB miss/error.',
  },
  {
    key: 'native_keys',
    enabled: false,
    description:
      'Native provider-opaque naap_ keys issued to a seat (/api/v1/teams/{id}/seats/{seatId}/keys). OFF = endpoints 404, no-op (NAAP-B).',
  },
  {
    key: 'key_validation_front_door',
    enabled: false,
    description:
      'Key validation front door POST /api/v1/keys/validate (resolves naap_ → provider via adapter, BPP ③). OFF = 404 so callers fall back to their direct path (NAAP-C).',
  },
  {
    key: 'capability_gate',
    enabled: false,
    description:
      'Enforce key → plan → capability access at the front door and discovery (NAAP-E). OFF = no enforcement (capabilities surfaced only, exactly as today); ON = deny a requested capability not granted by the resolved plan (fail closed).',
  },
  {
    key: SDK_CONNECTOR_FLAG,
    enabled: false,
    description:
      'Seed the public "sdk" Service Gateway connector (fronting sdk.daydream.monster at /api/v1/gw/sdk/*) AND accept native naap_ keys at the gateway authorize step (NAAP-5). OFF = no sdk connector seeded and naap_ keys are rejected at the gateway exactly as today (no-op).',
  },
  {
    key: PYMTHOUSE_BPP_VALIDATE_FLAG,
    enabled: false,
    description:
      'Resolve a validated key\'s capabilities LIVE from the pymthouse provider (BPP ②) via the M2M client, keyed on the account\'s externalUserId, and surface them at the validation front door. OFF = PymthouseAdapter.validate() is unimplemented (front door falls back to an empty capability set, exactly as today). Requires the provider\'s BPP_VALIDATE_V2 posture in the same environment; pairs with capability_gate (also default OFF).',
  },
  {
    key: PROVIDER_INSTANCES_FLAG,
    enabled: false,
    description:
      'Multi-app foundation (P0): resolve a per-ProviderInstance billing adapter built from the instance\'s non-secret config + a secretRef → SecretVault M2M secret, so multiple pymthouse apps can coexist. OFF = ProviderInstance table is never read and resolution falls back to the global PYMTHOUSE_* env single-app path exactly as today (zero regression).',
  },
  {
    key: MULTI_SUBSCRIPTION_FLAG,
    enabled: false,
    description:
      'Multi-subscription model (P1): a team may hold many concurrent Subscriptions and a DevApiKey may link to one via DevApiKey.subscriptionId. OFF = the Subscription table is never consulted and a key resolves via today\'s key → team → single billingAccountRef path (zero regression). A null subscriptionId always resolves the legacy way even when ON.',
  },
  {
    key: PLAN_SPEC_SYNC_FLAG,
    enabled: false,
    description:
      'Plan-spec → per-app discovery sync (P4): pull each ProviderInstance\'s published plans into ProviderPlan rows and auto-generate per-app DiscoveryPlans; the validate front door may expose the per-key discovery URL (key → subscription → ProviderPlan → DiscoveryPlan). OFF = no sync runs, ProviderPlan is never read/written, the catalog exposes no plans, and discovery is exactly today\'s static storyboard-default behavior (golden-set parity, zero regression).',
  },
  {
    key: PER_KEY_REMOTE_SIGNER_FLAG,
    enabled: false,
    description:
      'Per-key remote signer: the validation front door returns the signerSession ENDPOINT form { url, headers } pointing at the provider\'s per-key remote signer DMZ (pymthouse getSignerRouting DMZ URL + the minted pmth_ session), so the SDK service signs + pays through the funded per-key wallet. OFF = the front door returns the provider token-bundle form (pmth_ accessToken) exactly as today and performs no extra provider I/O (zero regression). Canary-only; pairs with simple-infra SIGNER_FROM_VALIDATE (the SDK service consumes the endpoint form only when its own flag is on).',
  },
];

/**
 * Read a single feature flag's effective state without writing to the DB.
 * Falls back to the KNOWN_FLAGS default (or `false`) when the flag row does not
 * exist yet, so a flag defaulting OFF is a no-op until an admin enables it.
 */
export async function isFeatureEnabled(key: string): Promise<boolean> {
  try {
    const flag = await prisma.featureFlag.findUnique({
      where: { key },
      select: { enabled: true },
    });
    if (flag) return flag.enabled;
  } catch {
    // Transient DB lookup failures must not break callers: fall through to the
    // static KNOWN_FLAGS default so a flag defaulting OFF stays a safe no-op.
  }
  return KNOWN_FLAGS.find((f) => f.key === key)?.enabled ?? false;
}

/**
 * Ensure all known flags exist in the database.
 * Uses upsert with no-op update so existing flags (and admin overrides) are preserved.
 */
export async function ensureKnownFlags(): Promise<void> {
  await Promise.all(
    KNOWN_FLAGS.map(flag =>
      prisma.featureFlag.upsert({
        where: { key: flag.key },
        update: {},
        create: {
          key: flag.key,
          enabled: flag.enabled,
          description: flag.description,
        },
      })
    )
  );
}
