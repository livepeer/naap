/**
 * Reference billing provider adapter: pymthouse (NAAP-A).
 *
 * Wraps the existing `getPmtHouseServerClient()` BEHIND the BillingProviderAdapter
 * SPI. This is the ONLY place that may import the pymthouse client; all other NaaP
 * code goes through the adapter + registry. Methods the NaaP side does not yet
 * support (BPP curation/manifest — PYMT-7 pending) throw
 * AdapterNotImplementedError rather than fabricating a response. BPP ④
 * `getPlans` and optional `subscribe` (checkout) are implemented.
 */

import 'server-only';

import { isPymthouseConfigured } from '@pymthouse/builder-sdk/config';
import { assertDirectSignerBaseUrl, isCompositeApiKey } from '@pymthouse/builder-sdk/signer/server';

import type { MeScopeUsagePayload, PmtHouseClient, UsageApiResponse } from '@pymthouse/builder-sdk';

import {
  exchangeApiKeyForSignerSession,
  getPmtHouseServerClient,
  mintOpaqueSignerSessionForExternalUser,
  mintSignerSessionForExternalUser,
  type PymthouseApiKeyExchangeConfig,
  type PymthouseSignerExchangeConfig,
} from '@/lib/pymthouse-client';
import { createPymthouseApiKey } from '@/lib/pymthouse-keys-bff';
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
  type SubscribeInput,
  type SubscribeResult,
  type UsageForExternalUserInput,
  type ValidateContext,
  type ValidateResult,
} from './adapter';
import { mapBillingProductsToPlans } from './pymthouse-plans';

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
   * Optional config for the app-scoped RFC 8693 API-key → signer JWT exchange
   * (`POST /api/v1/apps/{clientId}/oidc/token`). When present,
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

  /**
   * BPP ④ — live plan catalogue from pymthouse `GET …/plans` (SDK
   * `listBillingProducts`). Active products only; capability bundles are
   * taxonomy-normalized to `"<pipeline>:<model>"`.
   */
  async getPlans(): Promise<Plan[]> {
    const { products } = await this.client().listBillingProducts();
    return mapBillingProductsToPlans(products ?? []);
  }

  /**
   * Start pymthouse end-user checkout via SDK `createBillingCheckout`
   * (`POST …/billing/checkout`). Returns the Stripe Checkout URL; the
   * provider creates the OpenMeter subscription before returning.
   */
  async subscribe(input: SubscribeInput): Promise<SubscribeResult> {
    if (!this.isConfigured()) {
      throw new AdapterNotImplementedError(this.slug, 'subscribe');
    }
    const result = await this.client().createBillingCheckout({
      planId: input.planId,
      externalUserId: input.externalUserId,
      ...(input.successUrl ? { successUrl: input.successUrl } : {}),
      ...(input.cancelUrl ? { cancelUrl: input.cancelUrl } : {}),
    });
    return {
      checkoutUrl: result.checkoutUrl,
      ...(result.subscriptionId
        ? { subscriptionRef: result.subscriptionId }
        : {}),
    };
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
   * Per-key remote signer (endpoint form). Returns the {@link SignerSessionEndpoint}
   * form: the DMZ `url` + an `Authorization: Bearer …` header carrying a credential
   * the remote signer DMZ identity webhook actually accepts.
   *
   * The DMZ identity webhook is JWT / composite-key only: it verifies the bearer
   * as either a signer JWT (JWKS, `aud` = issuer, `client_id`/`azp`,
   * `scope` ⊇ `sign:job`, `sub` = app-user) OR a composite
   * `app_<24hex>_pmth_<secret>` API key (which the clearinghouse exchanges). A
   * bare opaque `pmth_…` session is REJECTED with `Invalid JWT` on the billed
   * `/generate-live-payment` webhook (the looser `/sign-orchestrator-info`
   * endpoint accepts it, which historically masked the asymmetry). So this method
   * NEVER forwards the opaque `session.accessToken`; `mintSignerSession` (the
   * flag-OFF default / Daydream path) still mints that opaque bundle byte-for-byte
   * for callers that use `/sign-orchestrator-info`, but the endpoint form emitted
   * here is produced ONLY inside this already-flag-gated method (front-door
   * `PER_KEY_REMOTE_SIGNER_FLAG`, fail-safe on error).
   *
   * Credential resolution (in preference order):
   *  1. API-key config (`apiKeyExchange` or the global `PYMTHOUSE_API_KEY`):
   *     a composite key is forwarded verbatim as the Bearer (identity webhook
   *     exchanges it); a bare `pmth_…` key is exchanged via
   *     `exchangeApiKeyForSignerSession` for a signer JWT + `signerUrl`.
   *  2. Legacy fallback (no API-key config): mint a fresh composite
   *     `app_<24hex>_pmth_<secret>` key via `createPymthouseApiKey` and forward
   *     it as the Bearer.
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
    // Preferred path: API-key config (`apiKeyExchange` or global `PYMTHOUSE_API_KEY`).
    // Composite keys go to the DMZ as Bearer (identity webhook exchanges them).
    // Bare `pmth_*` keys use RFC 8693 `POST …/apps/{clientId}/oidc/token` for a
    // short-lived signer JWT + `signer_url`. Unset by default ⇒ legacy
    // `getSignerRouting()` + mint path below (zero regression).
    //
    // The global `PYMTHOUSE_API_KEY` env is NOT consulted for a per-instance
    // adapter (one with an injected `clientOverride`): that key belongs to the
    // global `PYMTHOUSE_*` app, so falling back to it would silently exchange a
    // tenant's signer session against the WRONG app and break per-instance
    // isolation. A per-instance adapter therefore uses the new path only when
    // its own `apiKeyExchange` is injected, else the legacy per-instance mint.
    //
    // NOTE: this endpoint is authenticated by the API key itself and takes
    // no `externalUserId`, so identity/usage attribution is at the KEY level,
    // not per NaaP user.
    const apiKeyCfg =
      this.apiKeyExchange ?? (this.clientOverride ? undefined : readApiKeySignerSessionConfig());
    if (apiKeyCfg) {
      const apiKey = apiKeyCfg.apiKey.trim();
      // Composite keys (`app_<24hex>_<secret>`) authenticate the DMZ directly —
      // the clearinghouse identity webhook exchanges them. ONLY this path needs
      // `getSignerRouting()` to discover the DMZ url. A bare `pmth_…` key gets
      // its url from `exchangeApiKeyForSignerSession()` below and must NOT be
      // gated on signer routing (which it never needed) — doing so regressed
      // bare-key callers with a spurious "no remote signer DMZ url" throw.
      if (isCompositeApiKey(apiKey)) {
        const url = this.resolveDmzUrl(await this.client().getSignerRouting());
        return {
          url,
          headers: { Authorization: `Bearer ${apiKey}` },
        };
      }

      const session = await exchangeApiKeyForSignerSession(apiKeyCfg);
      const exchangeUrl = session.signerUrl;
      if (!exchangeUrl) {
        throw new Error('pymthouse api-key signer-session returned no signerUrl');
      }
      assertDirectSignerBaseUrl(exchangeUrl);
      return {
        url: exchangeUrl,
        headers: { Authorization: `Bearer ${session.accessToken}` },
      };
    }

    const url = this.resolveDmzUrl(await this.client().getSignerRouting());

    const externalUserId = context?.externalUserId;
    if (!externalUserId) {
      throw new Error('resolveSignerEndpoint requires externalUserId to mint the signer bearer');
    }

    // DMZ accepts composite `app_<24hex>_<secret>` Bearer (identity webhook).
    // NOTE (follow-up): this legacy fallback mints a fresh long-lived key per
    // resolution. It is only reached when neither an injected `apiKeyExchange`
    // nor a global `PYMTHOUSE_API_KEY` composite key is configured (prod uses
    // the composite fast-path above and never mints here). Key reuse/TTL/revoke
    // is deferred: the Builder Apps API returns the full secret ONLY at creation
    // (no list-returns-secret), so reuse needs new persistent secret storage +
    // rotation — tracked as a follow-up rather than mixed into this PR.
    const { apiKey } = await createPymthouseApiKey({
      externalUserId,
      label: 'naap-validate-signer',
    });

    return {
      url,
      headers: { Authorization: `Bearer ${apiKey}` },
    };
  }

  /**
   * Extract the direct-DMZ signer API url from a `getSignerRouting()` result and
   * validate it. Prefers `patterns.directDmz.signerApiUrl`, then
   * `routing.remoteDmzUrl`, then `routing.signerApiUrl`. Throws when none is
   * present (so the front door can fail safe to the token-bundle form) and
   * rejects dashboard `/api/signer` proxy bases via `assertDirectSignerBaseUrl`.
   */
  private resolveDmzUrl(
    routing: Awaited<ReturnType<PmtHouseClient['getSignerRouting']>>,
  ): string {
    const url =
      routing.patterns?.directDmz?.signerApiUrl ||
      routing.routing?.remoteDmzUrl ||
      routing.routing?.signerApiUrl ||
      '';
    if (!url) {
      throw new Error('pymthouse signer routing returned no remote signer DMZ url');
    }
    assertDirectSignerBaseUrl(url);
    return url;
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
