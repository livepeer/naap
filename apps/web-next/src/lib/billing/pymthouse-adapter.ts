/**
 * Reference billing provider adapter: pymthouse (NAAP-A).
 *
 * Wraps the existing `getPmtHouseServerClient()` BEHIND the BillingProviderAdapter
 * SPI. This is the ONLY place that may import the pymthouse client; all other NaaP
 * code goes through the adapter + registry. Methods the NaaP side does not yet
 * support (BPP validate/plans/curation/manifest — PYMT-3/5/7 pending) throw
 * AdapterNotImplementedError rather than fabricating a response.
 */

import 'server-only';

import { isPymthouseConfigured } from '@pymthouse/builder-sdk/config';
import { assertDirectSignerBaseUrl } from '@pymthouse/builder-sdk/signer/server';

import type { MeScopeUsagePayload, PmtHouseClient, UsageApiResponse } from '@pymthouse/builder-sdk';

import {
  exchangeApiKeyForSignerSession,
  getPmtHouseServerClient,
  mintOpaqueSignerSessionForExternalUser,
  mintSignerSessionForExternalUser,
  mintUserSignerJwtForExternalUser,
  type PymthouseApiKeyExchangeConfig,
  type PymthouseSignerExchangeConfig,
} from '@/lib/pymthouse-client';
import { readApiKeySignerSessionConfig } from '@/lib/pymthouse-signer-exchange-config';
import { isFeatureEnabled, PYMTHOUSE_BPP_VALIDATE_FLAG } from '@/lib/feature-flags';
import { resolvePymthouseCapabilities } from './pymthouse-capabilities';
import {
  AdapterNotImplementedError,
  type AppUsageInput,
  type BillingProviderAdapter,
  type Capability,
  type CuratedOrchestrator,
  type MintSignerSessionInput,
  type Plan,
  type ProviderSpendRecord,
  type ProviderSpendResult,
  type ProviderSpendScope,
  type SignerSessionEndpoint,
  type SignerSessionToken,
  type UsageForExternalUserInput,
  type ValidateContext,
  type ValidateResult,
} from './adapter';

export const PYMTHOUSE_ADAPTER_SLUG = 'pymthouse';

/**
 * Optional per-instance overrides (P0, `provider_instances`). When omitted the
 * adapter behaves EXACTLY as before — it talks to the global `PYMTHOUSE_*` env
 * singleton (`getPmtHouseServerClient()`) and reports configuration via
 * `isPymthouseConfigured()`. When the registry builds a per-`ProviderInstance`
 * adapter it injects a `client` constructed from that instance's config/secret
 * (so multiple pymthouse apps coexist) and an `isConfigured` that reflects the
 * instance.
 */
export interface PymthouseAdapterOptions {
  client?: PmtHouseClient;
  isConfigured?: () => boolean;
  /**
   * Per-instance signer-session exchange config (issuer + M2M creds). Required
   * alongside a `client` override so {@link PymthouseAdapter.mintSignerSession}
   * exchanges against THIS app's token endpoint. Omitted for the global-env
   * adapter, which uses the `PYMTHOUSE_*` env exchange.
   */
  signerExchange?: PymthouseSignerExchangeConfig;
  /**
   * Optional config for the NEW single-call signer-session exchange
   * (`POST /api/v1/apps/{clientId}/auth/api-key/signer-session`). When present,
   * {@link PymthouseAdapter.resolveSignerEndpoint} prefers it over the legacy
   * `getSignerRouting()` + user-JWT mint. Omitted by default; the global-env
   * adapter resolves it lazily from `PYMTHOUSE_API_KEY` (unset ⇒ legacy path).
   */
  apiKeyExchange?: PymthouseApiKeyExchangeConfig;
}

export class PymthouseAdapter implements BillingProviderAdapter {
  readonly slug = PYMTHOUSE_ADAPTER_SLUG;

  private readonly clientOverride?: PmtHouseClient;
  private readonly isConfiguredOverride?: () => boolean;
  private readonly signerExchange?: PymthouseSignerExchangeConfig;
  private readonly apiKeyExchange?: PymthouseApiKeyExchangeConfig;

  constructor(options: PymthouseAdapterOptions = {}) {
    this.clientOverride = options.client;
    this.isConfiguredOverride = options.isConfigured;
    this.signerExchange = options.signerExchange;
    this.apiKeyExchange = options.apiKeyExchange;
  }

  /**
   * The pymthouse client backing this adapter. Defaults to the global-env
   * process singleton (today's behavior) unless a per-instance client was
   * injected at construction.
   */
  private client(): PmtHouseClient {
    return this.clientOverride ?? getPmtHouseServerClient();
  }

  isConfigured(): boolean {
    return this.isConfiguredOverride ? this.isConfiguredOverride() : isPymthouseConfigured();
  }

  /**
   * BPP ② — resolve a validated account's capabilities live from pymthouse.
   *
   * The front door passes `billingAccountRef.accountId` here (the provider
   * `externalUserId`); see `pymthouse-capabilities.ts` for the O1 subject-identity
   * rationale. Gated behind `PYMTHOUSE_BPP_VALIDATE_FLAG` (default OFF): when OFF
   * this throws `AdapterNotImplementedError` exactly as before, so the front door
   * falls back to an empty capability set (zero regression). Provider errors
   * propagate so the front door fails CLOSED.
   */
  async validate(externalUserId: string, context?: ValidateContext): Promise<ValidateResult> {
    // Team-scoped flag when the front door supplies the key's owning team; else
    // global (today's behavior). A per-team override lets ONE team resolve live
    // capabilities without flipping `pymthouse_bpp_validate` for everyone.
    if (!(await isFeatureEnabled(PYMTHOUSE_BPP_VALIDATE_FLAG, context?.teamId))) {
      throw new AdapterNotImplementedError(this.slug, 'validate');
    }
    const resolved = await resolvePymthouseCapabilities(externalUserId);
    return {
      valid: true,
      capabilities: resolved.capabilities,
      quota: resolved.quota,
      ...(resolved.subscriptionRef ? { subscriptionRef: resolved.subscriptionRef } : {}),
    };
  }

  async getPlans(): Promise<Plan[]> {
    throw new AdapterNotImplementedError(this.slug, 'getPlans');
  }

  async getUsageForExternalUser(input: UsageForExternalUserInput): Promise<unknown> {
    return this.client().fetchUsageForExternalUser({
      externalUserId: input.externalUserId,
      startDate: input.startDate,
      endDate: input.endDate,
      ...(input.maxEndUserIds != null ? { maxEndUserIds: input.maxEndUserIds } : {}),
    });
  }

  async getAppUsage(input: AppUsageInput): Promise<unknown> {
    return this.client().getUsage({
      startDate: input.startDate,
      endDate: input.endDate,
      ...(input.groupBy ? { groupBy: input.groupBy } : {}),
      ...(input.userId ? { userId: input.userId } : {}),
    });
  }

  /**
   * Dashboard PULL: fetch pymthouse spend live via the M2M client and map the
   * SDK response into neutral `ProviderSpendRecord`s. Provider-internal wire
   * shapes never escape this method.
   *
   *  - Scoped (`accountId` present): `fetchUsageForExternalUser` is bound to that
   *    one external user, so pymthouse itself enforces the tenant boundary — we
   *    never even receive another tenant's usage. Yields one record with a
   *    per-pipeline/model `byCapability` rollup.
   *  - App-wide (`accountId` omitted): `getUsage(groupBy=user)` returns one row
   *    per app user, mapped to one record each (route layer restricts app-wide
   *    pulls to system:admin).
   */
  async getSpend(scope: ProviderSpendScope): Promise<ProviderSpendResult> {
    const client = this.client();

    if (scope.accountId) {
      const payload: MeScopeUsagePayload = await client.fetchUsageForExternalUser({
        externalUserId: scope.accountId,
        startDate: scope.startDate,
        endDate: scope.endDate,
      });
      return { records: [this.mapMeScopePayload(scope.accountId, payload)] };
    }

    const usage: UsageApiResponse = await client.getUsage({
      startDate: scope.startDate,
      endDate: scope.endDate,
      groupBy: 'user',
    });
    return {
      source: usage.source,
      records: this.mapAppUsage(usage),
    };
  }

  /** Map a per-external-user payload → one neutral record (with capability rollup). */
  private mapMeScopePayload(
    accountId: string,
    payload: MeScopeUsagePayload,
  ): ProviderSpendRecord {
    const u = payload.currentUser;
    const byCapability: Record<string, { tickets?: number; networkFeeUsdMicros?: string }> = {};
    for (const row of u.pipelineModels ?? []) {
      // Key by pipeline:model so the dashboard can break spend down by capability.
      byCapability[`${row.pipeline}:${row.modelId}`] = {
        tickets: row.requestCount,
        networkFeeUsdMicros: row.networkFeeUsdMicros,
      };
    }
    return {
      providerSlug: this.slug,
      accountId,
      appId: null,
      // pymthouse meters signed tickets per request; there is no separate session
      // count on this seam, so sessions stays 0 and tickets carries requestCount.
      sessions: 0,
      tickets: u.requestCount,
      // The fiat (USD-micros) usage path does not return wei; leave it null.
      feeWei: null,
      networkFeeUsdMicros: u.networkFeeUsdMicros,
      ...(Object.keys(byCapability).length > 0 ? { byCapability } : {}),
    };
  }

  /** Map an app-wide usage response → one neutral record per app user. */
  private mapAppUsage(usage: UsageApiResponse): ProviderSpendRecord[] {
    return (usage.byUser ?? []).map((row) => ({
      providerSlug: this.slug,
      // Unattributed rows roll up under "unknown" (matches the Usage API).
      accountId: row.externalUserId ?? row.endUserId ?? 'unknown',
      appId: null,
      sessions: 0,
      tickets: row.requestCount,
      feeWei: row.feeWei ?? null,
      networkFeeUsdMicros: row.networkFeeUsdMicros ?? null,
    }));
  }

  /**
   * Mint an OPAQUE `pmth_…` signer session for the account.
   *
   * Uses the NaaP opaque-session workaround (upsert user → mint user JWT →
   * token-exchange WITHOUT `resource`) rather than the SDK 0.4.3
   * `PmtHouseClient.mintSignerSessionForExternalUser`, which sets `resource` and
   * is routed by PymtHouse to signer-JWT exchange (no opaque `pmth_…` session) —
   * causing the validate front door's signer mint to fail. For a per-instance
   * adapter the exchange binds to THAT app's issuer/creds; the global-env adapter
   * uses the `PYMTHOUSE_*` env path.
   */
  async mintSignerSession(input: MintSignerSessionInput): Promise<SignerSessionToken> {
    const session =
      this.clientOverride && this.signerExchange
        ? await mintOpaqueSignerSessionForExternalUser({
            client: this.clientOverride,
            exchange: this.signerExchange,
            externalUserId: input.externalUserId,
            ...(input.email != null ? { email: input.email } : {}),
          })
        : await mintSignerSessionForExternalUser({
            externalUserId: input.externalUserId,
            ...(input.email != null ? { email: input.email } : {}),
          });
    return {
      accessToken: session.accessToken,
      tokenType: session.tokenType,
      expiresIn: session.expiresIn,
      scope: session.scope,
    };
  }

  /**
   * Per-key remote signer (endpoint form). Resolve the app's remote signer DMZ
   * via the Builder API `GET /api/v1/apps/{clientId}/signer/routing`
   * (`getSignerRouting()`), then return the {@link SignerSessionEndpoint} form:
   * the DMZ `url` + an `Authorization: Bearer <jwt>` header carrying a freshly
   * minted Builder USER-TOKEN JWT (via {@link mintUserSignerJwtForExternalUser}).
   *
   * Per the pymthouse "User-scoped JWTs" doc ("Passing the token to downstream
   * services") and the signer-routing `directDmz` pattern, the token the remote
   * signer DMZ validates is the Builder user-token (`/users/{id}/token`,
   * `sign:job`) — NOT the token-exchange "Option A" `sign:mint_user_token`
   * clearinghouse mint, which currently `500`s upstream. The DMZ identity
   * webhook is OIDC/JWT-only: it verifies the bearer as a JWT (JWKS, `aud` =
   * issuer, `client_id`/`azp`, `scope` ⊇ `sign:job`, `sub` = app-user) — an
   * opaque `pmth_…` session is rejected with `Invalid JWT` (502). So we forward
   * the user-token JWT here, NOT the opaque `session.accessToken`.
   * `mintSignerSession` (the flag-OFF default/Daydream path) still mints the
   * opaque bundle byte-for-byte; the JWT is produced ONLY inside this
   * already-flag-gated method (front-door `PER_KEY_REMOTE_SIGNER_FLAG`,
   * fail-safe on error).
   *
   * The DMZ URL is the direct-DMZ signer API (`patterns.directDmz.signerApiUrl`),
   * falling back to `routing.remoteDmzUrl`/`routing.signerApiUrl`, validated by
   * `assertDirectSignerBaseUrl` (rejects dashboard `/api/signer` proxy URLs).
   * Throws when the provider exposes no DMZ URL or no `externalUserId` so the
   * front door can fail safe (it keeps the token-bundle form rather than emit a
   * half-formed endpoint).
   */
  async resolveSignerEndpoint(
    _session: SignerSessionToken,
    context?: { externalUserId: string },
  ): Promise<SignerSessionEndpoint> {
    // NEW contract: a single authenticated POST to
    // `/api/v1/apps/{clientId}/auth/api-key/signer-session` returns BOTH the
    // remote signer DMZ url AND the bearer in one call (replacing the legacy
    // `getSignerRouting()` + user-JWT mint below). Preferred when an explicit
    // `apiKeyExchange` was injected (per-instance) OR — for the GLOBAL-env
    // adapter only — `PYMTHOUSE_API_KEY` is set. Unset by default ⇒ this branch
    // is skipped and the legacy path runs byte-for-byte (zero regression).
    //
    // The global `PYMTHOUSE_API_KEY` env is NOT consulted for a per-instance
    // adapter (one with an injected `clientOverride`): that key belongs to the
    // global `PYMTHOUSE_*` app, so falling back to it would silently exchange a
    // tenant's signer session against the WRONG app and break per-instance
    // isolation. A per-instance adapter therefore uses the new path only when
    // its own `apiKeyExchange` is injected, else the legacy per-instance mint.
    //
    // NOTE: this endpoint is authenticated by the `pmth_…` key itself and takes
    // no `externalUserId`, so identity/usage attribution is at the KEY level,
    // not per NaaP user.
    const apiKeyCfg =
      this.apiKeyExchange ?? (this.clientOverride ? undefined : readApiKeySignerSessionConfig());
    if (apiKeyCfg) {
      const session = await exchangeApiKeyForSignerSession(apiKeyCfg);
      const url = session.signerUrl;
      if (!url) {
        throw new Error('pymthouse api-key signer-session returned no signerUrl');
      }
      // Reject dashboard `/api/signer/*` proxy bases — signing RPCs must target
      // the remote-signer DMZ origin directly (builder-sdk 0.4.6).
      assertDirectSignerBaseUrl(url);
      return {
        url,
        headers: { Authorization: `Bearer ${session.accessToken}` },
      };
    }

    const routing = await this.client().getSignerRouting();
    const url =
      routing.patterns?.directDmz?.signerApiUrl ||
      routing.routing?.remoteDmzUrl ||
      routing.routing?.signerApiUrl ||
      '';
    if (!url) {
      throw new Error('pymthouse signer routing returned no remote signer DMZ url');
    }
    // Reject dashboard `/api/signer/*` proxy bases — signing RPCs must target
    // the remote-signer DMZ origin directly (builder-sdk 0.4.6).
    assertDirectSignerBaseUrl(url);

    const externalUserId = context?.externalUserId;
    if (!externalUserId) {
      throw new Error('resolveSignerEndpoint requires externalUserId to mint the user signer JWT');
    }

    // Mint the Builder user-token JWT against THIS adapter's client (the
    // per-instance client in subscription mode, else the global-env singleton),
    // so the JWT's `client_id` matches the app whose DMZ we resolved above.
    const { jwt } = await mintUserSignerJwtForExternalUser({
      client: this.client(),
      externalUserId,
    });

    return {
      url,
      headers: { Authorization: `Bearer ${jwt}` },
    };
  }

  async receiveCuratedOrchestrators(
    _plan: string,
    _list: CuratedOrchestrator[],
  ): Promise<void> {
    throw new AdapterNotImplementedError(this.slug, 'receiveCuratedOrchestrators');
  }

  async getCapabilityManifest(): Promise<Capability[]> {
    throw new AdapterNotImplementedError(this.slug, 'getCapabilityManifest');
  }
}
