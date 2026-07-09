/** @vitest-environment node */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fetchUsageForExternalUser = vi.fn();
const getUsage = vi.fn();
const getUserSubscription = vi.fn();
const listBillingProducts = vi.fn();
const getSignerRouting = vi.fn();
const mintUserSignerJwtForExternalUser = vi.fn();
const createPymthouseApiKey = vi.fn();
const globalSignerExchangeConfig = vi.fn();
const exchangeApiKeyForSignerSession = vi.fn();

vi.mock('@/lib/pymthouse-client', () => ({
  getPmtHouseServerClient: () => ({
    fetchUsageForExternalUser,
    getUsage,
    getUserSubscription,
    listBillingProducts,
    getSignerRouting,
  }),
  globalSignerExchangeConfig: () => globalSignerExchangeConfig(),
  mintUserSignerJwtForExternalUser: (input: unknown) => mintUserSignerJwtForExternalUser(input),
  exchangeApiKeyForSignerSession: (input: unknown) => exchangeApiKeyForSignerSession(input),
}));

vi.mock('@/lib/pymthouse-keys-bff', () => ({
  createPymthouseApiKey: (input: unknown) => createPymthouseApiKey(input),
}));

// Default: no global PYMTHOUSE_API_KEY → legacy per-user mint path (zero
// regression). Tests that exercise the new endpoint pass `apiKeyExchange`
// explicitly via the adapter options instead.
const readApiKeySignerSessionConfig = vi.fn(() => null);
vi.mock('@/lib/pymthouse-signer-exchange-config', () => ({
  readApiKeySignerSessionConfig: () => readApiKeySignerSessionConfig(),
}));

vi.mock('@pymthouse/builder-sdk/config', () => ({
  isPymthouseConfigured: () => true,
}));

const isFeatureEnabled = vi.fn();
vi.mock('@/lib/feature-flags', () => ({
  isFeatureEnabled: (...a: unknown[]) => isFeatureEnabled(...a),
  PYMTHOUSE_BPP_VALIDATE_FLAG: 'pymthouse_bpp_validate',
}));

import { PymthouseAdapter } from './pymthouse-adapter';
import { AdapterNotImplementedError } from './adapter';
import { resetPymthouseCapabilityCacheForTests } from './pymthouse-capabilities';

const WINDOW = { startDate: '2026-01-01T00:00:00.000Z', endDate: '2026-01-31T23:59:59.999Z' };

let adapter: PymthouseAdapter;

beforeEach(() => {
  vi.clearAllMocks();
  resetPymthouseCapabilityCacheForTests();
  isFeatureEnabled.mockResolvedValue(false);
  globalSignerExchangeConfig.mockReturnValue({
    issuerUrl: 'https://pymthouse.com/api/v1/oidc',
    m2mClientId: 'm2m_test',
    m2mClientSecret: 'secret_test',
  });
  createPymthouseApiKey.mockResolvedValue({
    apiKey: 'app_testclient.pmth_composite_key_secret',
    row: {
      id: 'key-1',
      label: 'naap-validate-signer',
      prefix: 'app_test',
      suffix: 'cret',
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      revokedAt: null,
    },
  });
  adapter = new PymthouseAdapter();
});

afterEach(() => {
  vi.restoreAllMocks();
  resetPymthouseCapabilityCacheForTests();
});

describe('PymthouseAdapter.validate (BPP ② live capabilities, flag-gated)', () => {
  it('flag OFF → throws AdapterNotImplementedError (zero regression, no provider call)', async () => {
    isFeatureEnabled.mockResolvedValue(false);
    await expect(adapter.validate('acct_om_1')).rejects.toBeInstanceOf(AdapterNotImplementedError);
    expect(getUserSubscription).not.toHaveBeenCalled();
  });

  it('flag ON + delegated account (no subscription) → wildcard capabilities', async () => {
    isFeatureEnabled.mockResolvedValue(true);
    getUserSubscription.mockResolvedValue({ externalUserId: 'acct_om_1', subscription: null });

    const res = await adapter.validate('acct_om_1');
    expect(getUserSubscription).toHaveBeenCalledWith('acct_om_1');
    expect(res.valid).toBe(true);
    expect(res.capabilities).toEqual(['*']);
    expect(res.quota).toBeNull();
  });

  it('flag ON + plan-backed account → mapped, taxonomy-normalized capabilities', async () => {
    isFeatureEnabled.mockResolvedValue(true);
    getUserSubscription.mockResolvedValue({
      externalUserId: 'acct_om_1',
      subscription: { id: 'sub_1', status: 'active', planId: 'plan_pro', createdAt: 'x' },
    });
    listBillingProducts.mockResolvedValue({
      apiVersion: 1,
      products: [
        {
          id: 'plan_pro',
          capabilities: [
            { pipeline: 'text-to-image', modelId: 'flux-dev' },
            { pipeline: 'live-video-to-video', modelId: 'scope' },
          ],
        },
      ],
    });

    const res = await adapter.validate('acct_om_1');
    expect(res.capabilities).toEqual(['text-to-image:flux-dev', 'live-video-to-video:scope']);
    expect(res.subscriptionRef).toBe('sub_1');
  });

  it('flag ON + provider error → propagates (front door fails closed)', async () => {
    isFeatureEnabled.mockResolvedValue(true);
    getUserSubscription.mockRejectedValue(new Error('provider down'));
    await expect(adapter.validate('acct_om_1')).rejects.toThrow('provider down');
  });
});

describe('PymthouseAdapter per-instance client (P0, zero regression)', () => {
  it('default constructor → talks to the global-env client singleton (today\'s behavior)', async () => {
    getUsage.mockResolvedValue({ byUser: [] });
    const a = new PymthouseAdapter();
    await a.getAppUsage(WINDOW);
    // `getUsage` is the env client mock from getPmtHouseServerClient().
    expect(getUsage).toHaveBeenCalled();
  });

  it('injected client → uses that client instead of the env singleton', async () => {
    const instanceGetUsage = vi.fn().mockResolvedValue({ byUser: [] });
    const a = new PymthouseAdapter({
      client: { getUsage: instanceGetUsage } as never,
      isConfigured: () => true,
    });
    await a.getAppUsage(WINDOW);
    expect(instanceGetUsage).toHaveBeenCalled();
    expect(getUsage).not.toHaveBeenCalled();
  });

  it('isConfigured honors the injected override, else delegates to the env check', () => {
    expect(new PymthouseAdapter({ isConfigured: () => false }).isConfigured()).toBe(false);
    expect(new PymthouseAdapter().isConfigured()).toBe(true);
  });
});

describe('PymthouseAdapter.resolveSignerEndpoint (per-key remote signer, composite API key)', () => {
  const TOKEN = { accessToken: 'pmth_abc123', tokenType: 'Bearer', expiresIn: 3600, scope: 'sign:job' };
  const CTX = { externalUserId: 'acct_user_42' };

  it('mints a composite app.pmth_ key and forwards it as the Bearer', async () => {
    getSignerRouting.mockResolvedValue({
      clientId: 'app_x',
      routing: { signerApiUrl: 'https://api.pymthouse.com', remoteDmzUrl: null, jwksUri: 'j', identityMode: 'jwt', meteringMode: 'platform_ingest' },
      patterns: {
        directDmz: { description: '', signerApiUrl: 'https://signer-dmz.pymthouse.com', webhookUrl: 'https://hook' },
        deprecatedHostedFacade: { description: '', signerApiUrl: null },
      },
    });

    const ep = await adapter.resolveSignerEndpoint(TOKEN, CTX);
    expect(getSignerRouting).toHaveBeenCalledTimes(1);
    expect(createPymthouseApiKey).toHaveBeenCalledWith({
      externalUserId: 'acct_user_42',
      label: 'naap-validate-signer',
    });
    expect(ep).toEqual({
      url: 'https://signer-dmz.pymthouse.com',
      headers: { Authorization: 'Bearer app_testclient.pmth_composite_key_secret' },
    });
    expect(mintUserSignerJwtForExternalUser).not.toHaveBeenCalled();
  });

  it('uses the per-instance client routing when one is injected', async () => {
    const instanceClient = { getSignerRouting } as never;
    const instanceExchange = {
      issuerUrl: 'https://tenant.pymthouse.com/api/v1/oidc',
      m2mClientId: 'm2m_tenant',
      m2mClientSecret: 'secret_tenant',
    };
    const a = new PymthouseAdapter({
      client: instanceClient,
      isConfigured: () => true,
      signerExchange: instanceExchange,
    });
    getSignerRouting.mockResolvedValue({
      clientId: 'app_tenant',
      routing: { signerApiUrl: 'https://api.pymthouse.com', remoteDmzUrl: 'https://dmz.pymthouse.com', jwksUri: 'j', identityMode: 'jwt', meteringMode: 'platform_ingest' },
      patterns: { directDmz: { description: '', signerApiUrl: '', webhookUrl: '' }, deprecatedHostedFacade: { description: '', signerApiUrl: null } },
    });

    await a.resolveSignerEndpoint(TOKEN, CTX);
    expect(createPymthouseApiKey).toHaveBeenCalledWith({
      externalUserId: 'acct_user_42',
      label: 'naap-validate-signer',
    });
    expect(globalSignerExchangeConfig).not.toHaveBeenCalled();
  });

  it('falls back to routing.remoteDmzUrl when directDmz is absent', async () => {
    getSignerRouting.mockResolvedValue({
      clientId: 'app_x',
      routing: { signerApiUrl: 'https://api.pymthouse.com', remoteDmzUrl: 'https://dmz.pymthouse.com', jwksUri: 'j', identityMode: 'jwt', meteringMode: 'platform_ingest' },
      patterns: { directDmz: { description: '', signerApiUrl: '', webhookUrl: '' }, deprecatedHostedFacade: { description: '', signerApiUrl: null } },
    });

    const ep = await adapter.resolveSignerEndpoint(TOKEN, CTX);
    expect(ep.url).toBe('https://dmz.pymthouse.com');
  });

  it('throws when the provider exposes no DMZ url (front door fails safe)', async () => {
    getSignerRouting.mockResolvedValue({
      clientId: 'app_x',
      routing: { signerApiUrl: '', remoteDmzUrl: null, jwksUri: 'j', identityMode: 'jwt', meteringMode: 'platform_ingest' },
      patterns: { directDmz: { description: '', signerApiUrl: '', webhookUrl: '' }, deprecatedHostedFacade: { description: '', signerApiUrl: null } },
    });

    await expect(adapter.resolveSignerEndpoint(TOKEN, CTX)).rejects.toThrow(/no remote signer DMZ url/);
    expect(createPymthouseApiKey).not.toHaveBeenCalled();
  });

  it('rejects a dashboard /api/signer proxy base (must target the DMZ directly)', async () => {
    getSignerRouting.mockResolvedValue({
      clientId: 'app_x',
      routing: { signerApiUrl: 'https://dashboard.pymthouse.com/api/signer', remoteDmzUrl: null, jwksUri: 'j', identityMode: 'jwt', meteringMode: 'platform_ingest' },
      patterns: { directDmz: { description: '', signerApiUrl: 'https://dashboard.pymthouse.com/api/signer', webhookUrl: '' }, deprecatedHostedFacade: { description: '', signerApiUrl: null } },
    });

    await expect(adapter.resolveSignerEndpoint(TOKEN, CTX)).rejects.toThrow();
    expect(createPymthouseApiKey).not.toHaveBeenCalled();
  });

  it('throws when no externalUserId is provided (cannot mint a composite key)', async () => {
    getSignerRouting.mockResolvedValue({
      clientId: 'app_x',
      routing: { signerApiUrl: 'https://api.pymthouse.com', remoteDmzUrl: 'https://dmz.pymthouse.com', jwksUri: 'j', identityMode: 'jwt', meteringMode: 'platform_ingest' },
      patterns: { directDmz: { description: '', signerApiUrl: '', webhookUrl: '' }, deprecatedHostedFacade: { description: '', signerApiUrl: null } },
    });

    await expect(adapter.resolveSignerEndpoint(TOKEN)).rejects.toThrow(/externalUserId/);
    expect(createPymthouseApiKey).not.toHaveBeenCalled();
  });

  it('propagates a mint error so the front door fails safe to the token bundle', async () => {
    getSignerRouting.mockResolvedValue({
      clientId: 'app_x',
      routing: { signerApiUrl: 'https://api.pymthouse.com', remoteDmzUrl: 'https://dmz.pymthouse.com', jwksUri: 'j', identityMode: 'jwt', meteringMode: 'platform_ingest' },
      patterns: { directDmz: { description: '', signerApiUrl: '', webhookUrl: '' }, deprecatedHostedFacade: { description: '', signerApiUrl: null } },
    });
    createPymthouseApiKey.mockRejectedValue(new Error('mint failed'));

    await expect(adapter.resolveSignerEndpoint(TOKEN, CTX)).rejects.toThrow('mint failed');
  });
});

describe('PymthouseAdapter.resolveSignerEndpoint (NEW api-key signer-session exchange)', () => {
  const TOKEN = { accessToken: 'pmth_abc123', tokenType: 'Bearer', expiresIn: 3600, scope: 'sign:job' };
  const CTX = { externalUserId: 'acct_user_42' };

  it('explicit apiKeyExchange with bare pmth_ key → exchange supplies url + bearer', async () => {
    getSignerRouting.mockResolvedValue({
      clientId: 'app_x',
      routing: { signerApiUrl: 'https://api.pymthouse.com', remoteDmzUrl: null, jwksUri: 'j', identityMode: 'jwt', meteringMode: 'platform_ingest' },
      patterns: {
        directDmz: { description: '', signerApiUrl: 'https://signer-dmz.pymthouse.com', webhookUrl: 'https://hook' },
        deprecatedHostedFacade: { description: '', signerApiUrl: null },
      },
    });
    exchangeApiKeyForSignerSession.mockResolvedValue({
      accessToken: 'eyJhbGciOiJSUzI1NiJ9.signer.sig',
      signerUrl: 'https://signer-dmz.pymthouse.com',
      expiresIn: 900,
      scope: 'sign:job',
      tokenType: 'Bearer',
    });
    const a = new PymthouseAdapter({
      apiKeyExchange: { billingUrl: 'https://pymthouse.com', clientId: 'app_x', apiKey: 'pmth_key' },
    });

    const ep = await a.resolveSignerEndpoint(TOKEN, CTX);

    expect(exchangeApiKeyForSignerSession).toHaveBeenCalledWith({
      billingUrl: 'https://pymthouse.com',
      clientId: 'app_x',
      apiKey: 'pmth_key',
    });
    expect(ep).toEqual({
      url: 'https://signer-dmz.pymthouse.com',
      headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.signer.sig' },
    });
    expect(mintUserSignerJwtForExternalUser).not.toHaveBeenCalled();
  });

  it('bare pmth_ key does NOT require signer routing (regression: exchange supplies its own url)', async () => {
    // Regression guard: the bare-key exchange path must not call
    // getSignerRouting() nor be gated on it. Even when routing would expose NO
    // DMZ url, a bare pmth_ key still resolves via the exchange's own signerUrl.
    getSignerRouting.mockResolvedValue({
      clientId: 'app_x',
      routing: { signerApiUrl: '', remoteDmzUrl: null, jwksUri: 'j', identityMode: 'jwt', meteringMode: 'platform_ingest' },
      patterns: { directDmz: { description: '', signerApiUrl: '', webhookUrl: '' }, deprecatedHostedFacade: { description: '', signerApiUrl: null } },
    });
    exchangeApiKeyForSignerSession.mockResolvedValue({
      accessToken: 'eyJhbGciOiJSUzI1NiJ9.signer.sig',
      signerUrl: 'https://signer-dmz.pymthouse.com',
      expiresIn: 900,
      scope: 'sign:job',
      tokenType: 'Bearer',
    });
    const a = new PymthouseAdapter({
      apiKeyExchange: { billingUrl: 'https://pymthouse.com', clientId: 'app_x', apiKey: 'pmth_bare_key' },
    });

    const ep = await a.resolveSignerEndpoint(TOKEN, CTX);

    expect(getSignerRouting).not.toHaveBeenCalled();
    expect(exchangeApiKeyForSignerSession).toHaveBeenCalledWith({
      billingUrl: 'https://pymthouse.com',
      clientId: 'app_x',
      apiKey: 'pmth_bare_key',
    });
    expect(ep).toEqual({
      url: 'https://signer-dmz.pymthouse.com',
      headers: { Authorization: 'Bearer eyJhbGciOiJSUzI1NiJ9.signer.sig' },
    });
  });

  it('composite apiKeyExchange forwards the key directly (no exchange hop)', async () => {
    getSignerRouting.mockResolvedValue({
      clientId: 'app_x',
      routing: { signerApiUrl: 'https://api.pymthouse.com', remoteDmzUrl: null, jwksUri: 'j', identityMode: 'jwt', meteringMode: 'platform_ingest' },
      patterns: {
        directDmz: { description: '', signerApiUrl: 'https://signer-dmz.pymthouse.com', webhookUrl: 'https://hook' },
        deprecatedHostedFacade: { description: '', signerApiUrl: null },
      },
    });
    const a = new PymthouseAdapter({
      apiKeyExchange: {
        billingUrl: 'https://pymthouse.com',
        clientId: 'app_x',
        apiKey: 'app_x.pmth_composite_secret',
      },
    });

    const ep = await a.resolveSignerEndpoint(TOKEN, CTX);

    expect(exchangeApiKeyForSignerSession).not.toHaveBeenCalled();
    expect(ep).toEqual({
      url: 'https://signer-dmz.pymthouse.com',
      headers: { Authorization: 'Bearer app_x.pmth_composite_secret' },
    });
  });

  it('global PYMTHOUSE_API_KEY env config is used when no explicit option is injected', async () => {
    readApiKeySignerSessionConfig.mockReturnValueOnce({
      billingUrl: 'https://pymthouse.com',
      clientId: 'app_env',
      apiKey: 'pmth_env_key',
    } as never);
    getSignerRouting.mockResolvedValue({
      clientId: 'app_env',
      routing: { signerApiUrl: 'https://api.pymthouse.com', remoteDmzUrl: null, jwksUri: 'j', identityMode: 'jwt', meteringMode: 'platform_ingest' },
      patterns: {
        directDmz: { description: '', signerApiUrl: 'https://signer-dmz.pymthouse.com', webhookUrl: '' },
        deprecatedHostedFacade: { description: '', signerApiUrl: null },
      },
    });
    exchangeApiKeyForSignerSession.mockResolvedValue({
      accessToken: 'env.signer.jwt',
      signerUrl: 'https://signer-dmz.pymthouse.com',
      expiresIn: 900,
      scope: 'sign:job',
      tokenType: 'Bearer',
    });

    const ep = await adapter.resolveSignerEndpoint(TOKEN, CTX);

    expect(exchangeApiKeyForSignerSession).toHaveBeenCalledWith({
      billingUrl: 'https://pymthouse.com',
      clientId: 'app_env',
      apiKey: 'pmth_env_key',
    });
    expect(ep.url).toBe('https://signer-dmz.pymthouse.com');
  });

  it('per-instance adapter (injected client) does NOT fall back to the global PYMTHOUSE_API_KEY env', async () => {
    // A per-instance adapter must stay bound to ITS app: the global env key is
    // never even consulted (short-circuited by the injected client), so it uses
    // the legacy per-instance mint instead of the global app's api key.
    getSignerRouting.mockResolvedValue({
      clientId: 'app_tenant',
      routing: { signerApiUrl: 'https://api.pymthouse.com', remoteDmzUrl: 'https://dmz.tenant.com', jwksUri: 'j', identityMode: 'jwt', meteringMode: 'platform_ingest' },
      patterns: { directDmz: { description: '', signerApiUrl: '', webhookUrl: '' }, deprecatedHostedFacade: { description: '', signerApiUrl: null } },
    });
    const a = new PymthouseAdapter({ client: { getSignerRouting } as never, isConfigured: () => true });

    const ep = await a.resolveSignerEndpoint(TOKEN, CTX);

    // The global env key is never read, the api-key exchange never runs, and the
    // legacy per-instance mint is used instead (tenant isolation preserved).
    expect(readApiKeySignerSessionConfig).not.toHaveBeenCalled();
    expect(exchangeApiKeyForSignerSession).not.toHaveBeenCalled();
    expect(getSignerRouting).toHaveBeenCalledTimes(1);
    expect(createPymthouseApiKey).toHaveBeenCalled();
    expect(ep.url).toBe('https://dmz.tenant.com');
  });

  it('throws when the exchange returns no signerUrl (front door fails safe)', async () => {
    getSignerRouting.mockResolvedValue({
      clientId: 'app_x',
      routing: { signerApiUrl: 'https://api.pymthouse.com', remoteDmzUrl: 'https://signer-dmz.pymthouse.com', jwksUri: 'j', identityMode: 'jwt', meteringMode: 'platform_ingest' },
      patterns: {
        directDmz: { description: '', signerApiUrl: 'https://signer-dmz.pymthouse.com', webhookUrl: '' },
        deprecatedHostedFacade: { description: '', signerApiUrl: null },
      },
    });
    exchangeApiKeyForSignerSession.mockResolvedValue({
      accessToken: 'jwt', signerUrl: null, expiresIn: 900, scope: 'sign:job', tokenType: 'Bearer',
    });
    const a = new PymthouseAdapter({
      apiKeyExchange: { billingUrl: 'https://pymthouse.com', clientId: 'app_x', apiKey: 'pmth_key' },
    });
    await expect(a.resolveSignerEndpoint(TOKEN, CTX)).rejects.toThrow(/no signerUrl/);
  });

  it('rejects a dashboard /api/signer proxy base returned by the exchange', async () => {
    getSignerRouting.mockResolvedValue({
      clientId: 'app_x',
      routing: { signerApiUrl: 'https://api.pymthouse.com', remoteDmzUrl: 'https://signer-dmz.pymthouse.com', jwksUri: 'j', identityMode: 'jwt', meteringMode: 'platform_ingest' },
      patterns: {
        directDmz: { description: '', signerApiUrl: 'https://signer-dmz.pymthouse.com', webhookUrl: '' },
        deprecatedHostedFacade: { description: '', signerApiUrl: null },
      },
    });
    exchangeApiKeyForSignerSession.mockResolvedValue({
      accessToken: 'jwt',
      signerUrl: 'https://dashboard.pymthouse.com/api/signer',
      expiresIn: 900,
      scope: 'sign:job',
      tokenType: 'Bearer',
    });
    const a = new PymthouseAdapter({
      apiKeyExchange: { billingUrl: 'https://pymthouse.com', clientId: 'app_x', apiKey: 'pmth_key' },
    });
    await expect(a.resolveSignerEndpoint(TOKEN, CTX)).rejects.toThrow();
  });
});

describe('PymthouseAdapter.getSpend', () => {
  it('scoped pull: asks the provider for ONE external user and maps to a neutral record', async () => {
    fetchUsageForExternalUser.mockResolvedValue({
      clientId: 'app_1',
      period: { start: WINDOW.startDate, end: WINDOW.endDate },
      currentUser: {
        externalUserId: 'acct_self',
        requestCount: 42,
        currency: 'USD',
        networkFeeUsdMicros: '9000',
        ownerChargeUsdMicros: '12000',
        endUserBillableUsdMicros: '15000',
        pipelineModels: [
          {
            pipeline: 'text-to-image',
            modelId: 'sdxl',
            requestCount: 30,
            currency: 'USD',
            networkFeeUsdMicros: '6000',
            ownerChargeUsdMicros: '8000',
            endUserBillableUsdMicros: '10000',
          },
          {
            pipeline: 'live-video',
            modelId: 'lvx',
            requestCount: 12,
            currency: 'USD',
            networkFeeUsdMicros: '3000',
            ownerChargeUsdMicros: '4000',
            endUserBillableUsdMicros: '5000',
          },
        ],
      },
    });

    const result = await adapter.getSpend({ accountId: 'acct_self', ...WINDOW });

    // Tenant boundary: the provider was asked for this one external user only.
    expect(fetchUsageForExternalUser).toHaveBeenCalledWith({
      externalUserId: 'acct_self',
      startDate: WINDOW.startDate,
      endDate: WINDOW.endDate,
    });
    expect(getUsage).not.toHaveBeenCalled();
    expect(result.records).toEqual([
      {
        providerSlug: 'pymthouse',
        accountId: 'acct_self',
        appId: null,
        sessions: 0,
        tickets: 42,
        feeWei: null,
        networkFeeUsdMicros: '9000',
        byCapability: {
          'text-to-image:sdxl': { tickets: 30, networkFeeUsdMicros: '6000' },
          'live-video:lvx': { tickets: 12, networkFeeUsdMicros: '3000' },
        },
      },
    ]);
  });

  it('scoped pull with no pipeline rows omits byCapability', async () => {
    fetchUsageForExternalUser.mockResolvedValue({
      clientId: 'app_1',
      period: { start: WINDOW.startDate, end: WINDOW.endDate },
      currentUser: {
        externalUserId: 'acct_self',
        requestCount: 3,
        currency: 'USD',
        networkFeeUsdMicros: '300',
        ownerChargeUsdMicros: '0',
        endUserBillableUsdMicros: '0',
        pipelineModels: [],
      },
    });

    const result = await adapter.getSpend({ accountId: 'acct_self', ...WINDOW });
    expect('byCapability' in result.records[0]).toBe(false);
  });

  it('app-wide pull: maps one neutral record per app user and surfaces source', async () => {
    getUsage.mockResolvedValue({
      clientId: 'app_1',
      source: 'openmeter',
      period: { start: WINDOW.startDate, end: WINDOW.endDate },
      totals: { requestCount: 50 },
      byUser: [
        { endUserId: 'eu1', externalUserId: 'acct_a', requestCount: 30, feeWei: '1000', networkFeeUsdMicros: '6000' },
        // Unattributed row: Usage API returns endUserId "unknown" + externalUserId null.
        { endUserId: 'unknown', externalUserId: null, requestCount: 20, feeWei: '500', networkFeeUsdMicros: '4000' },
      ],
    });

    const result = await adapter.getSpend({ ...WINDOW });

    expect(getUsage).toHaveBeenCalledWith({ startDate: WINDOW.startDate, endDate: WINDOW.endDate, groupBy: 'user' });
    expect(fetchUsageForExternalUser).not.toHaveBeenCalled();
    expect(result.source).toBe('openmeter');
    expect(result.records).toEqual([
      { providerSlug: 'pymthouse', accountId: 'acct_a', appId: null, sessions: 0, tickets: 30, feeWei: '1000', networkFeeUsdMicros: '6000' },
      { providerSlug: 'pymthouse', accountId: 'unknown', appId: null, sessions: 0, tickets: 20, feeWei: '500', networkFeeUsdMicros: '4000' },
    ]);
  });
});
