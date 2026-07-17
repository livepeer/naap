#!/usr/bin/env node
/**
 * Run 48b — local simulation of main@db9a6006 (#424) resolveSignerEndpoint
 * failure modes. No secrets logged. Optional live M2M probe when PYMTHOUSE_* env set.
 */

const COMPOSITE_API_KEY_RE = /^(app_[a-f0-9]{24})_(.+)$/;
function isCompositeApiKey(token) {
  const trimmed = token.trim();
  const match = COMPOSITE_API_KEY_RE.exec(trimmed);
  if (!match) return false;
  const apiKey = match[2];
  return Boolean(apiKey && !/^pmth_[a-f0-9]+$/i.test(apiKey));
}

function assertDirectSignerBaseUrl(signerBaseUrl) {
  const parsed = new URL(signerBaseUrl.trim());
  const pathname = parsed.pathname.replace(/\/+$/, '');
  if (pathname === '/api/signer' || pathname.startsWith('/api/signer/')) {
    throw new Error('invalid_signer_url: dashboard /api/signer proxy');
  }
}

function resolveDmzUrl(routing) {
  const url =
    routing.patterns?.directDmz?.signerApiUrl ||
    routing.routing?.remoteDmzUrl ||
    routing.routing?.signerApiUrl ||
    '';
  if (!url) throw new Error('pymthouse signer routing returned no remote signer DMZ url');
  assertDirectSignerBaseUrl(url);
  return url;
}

function readApiKeySignerSessionConfig(env) {
  const issuerUrl = env.PYMTHOUSE_ISSUER_URL?.trim();
  const clientId = env.PYMTHOUSE_PUBLIC_CLIENT_ID?.trim();
  const apiKey = env.PYMTHOUSE_API_KEY?.trim();
  if (!issuerUrl || !clientId || !apiKey) return null;
  const billingUrl = issuerUrl.replace(/\/api\/v1\/oidc\/?$/i, '').replace(/\/+$/, '');
  return { billingUrl, clientId, apiKey };
}

function simulateResolve(apiKeyCfg, routing, { externalUserId, createKeyOk = true } = {}) {
  if (apiKeyCfg) {
    const apiKey = apiKeyCfg.apiKey.trim();
    if (isCompositeApiKey(apiKey)) {
      const url = resolveDmzUrl(routing);
      return { path: 'composite-fast', url, bearerKind: 'composite' };
    }
    // bare / dot-format → RFC8693 exchange branch (network not simulated here)
    if (apiKey.includes('.pmth_')) {
      throw new Error('dot-format key: isCompositeApiKey=false → oidc/token exchange (expected fail on #424)');
    }
    if (!routing.exchangeSignerUrl) {
      throw new Error('pymthouse api-key signer-session returned no signerUrl');
    }
    return { path: 'bare-pmth-exchange', url: routing.exchangeSignerUrl, bearerKind: 'jwt' };
  }
  const url = resolveDmzUrl(routing);
  if (!externalUserId) {
    throw new Error('resolveSignerEndpoint requires externalUserId to mint the signer bearer');
  }
  if (!createKeyOk) throw new Error('createPymthouseApiKey failed (simulated)');
  return { path: 'legacy-mint-key', url, bearerKind: 'composite-minted' };
}

const goodRouting = {
  patterns: {
    directDmz: {
      signerApiUrl: 'https://pymthouse-signer-test-production.up.railway.app',
      webhookUrl: 'https://pymthouse.com/webhooks/remote-signer',
    },
  },
  routing: { remoteDmzUrl: null, signerApiUrl: 'https://pymthouse.com' },
};

const emptyDmzRouting = {
  patterns: { directDmz: { signerApiUrl: '', webhookUrl: '' } },
  routing: { remoteDmzUrl: null, signerApiUrl: '' },
};

const proxyRouting = {
  patterns: { directDmz: { signerApiUrl: 'https://pymthouse.com/api/signer', webhookUrl: '' } },
  routing: { remoteDmzUrl: null, signerApiUrl: '' },
};

console.log('=== resolveSignerEndpoint simulation (main #424 logic) ===\n');

const scenarios = [
  {
    name: 'PYMTHOUSE_API_KEY unset → legacy mint-key path',
    env: {
      PYMTHOUSE_ISSUER_URL: 'https://pymthouse.com/api/v1/oidc',
      PYMTHOUSE_PUBLIC_CLIENT_ID: 'app_98575870d7ae33589a3f0660',
    },
    routing: goodRouting,
    externalUserId: '2f617839-3588-4700-a6db-8438068c2b7f',
  },
  {
    name: 'PYMTHOUSE_API_KEY underscore composite → composite fast-path',
    env: {
      PYMTHOUSE_ISSUER_URL: 'https://pymthouse.com/api/v1/oidc',
      PYMTHOUSE_PUBLIC_CLIENT_ID: 'app_98575870d7ae33589a3f0660',
      PYMTHOUSE_API_KEY: 'app_98575870d7ae33589a3f0660_pmth_simulatedsecret',
    },
    routing: goodRouting,
  },
  {
    name: 'PYMTHOUSE_API_KEY legacy dot composite → exchange branch throws',
    env: {
      PYMTHOUSE_ISSUER_URL: 'https://pymthouse.com/api/v1/oidc',
      PYMTHOUSE_PUBLIC_CLIENT_ID: 'app_98575870d7ae33589a3f0660',
      PYMTHOUSE_API_KEY: 'app_98575870d7ae33589a3f0660.pmth_simulatedsecret',
    },
    routing: goodRouting,
  },
  {
    name: 'PYMTHOUSE_API_KEY bare pmth_ without signerUrl in exchange → throws',
    env: {
      PYMTHOUSE_ISSUER_URL: 'https://pymthouse.com/api/v1/oidc',
      PYMTHOUSE_PUBLIC_CLIENT_ID: 'app_98575870d7ae33589a3f0660',
      PYMTHOUSE_API_KEY: 'pmth_simulatedsecret',
    },
    routing: { ...goodRouting, exchangeSignerUrl: null },
  },
  {
    name: 'getSignerRouting empty DMZ → throws (fail-safe)',
    env: {
      PYMTHOUSE_ISSUER_URL: 'https://pymthouse.com/api/v1/oidc',
      PYMTHOUSE_PUBLIC_CLIENT_ID: 'app_98575870d7ae33589a3f0660',
      PYMTHOUSE_API_KEY: 'app_98575870d7ae33589a3f0660_pmth_simulatedsecret',
    },
    routing: emptyDmzRouting,
  },
  {
    name: 'dashboard /api/signer proxy URL → assertDirectSignerBaseUrl throws',
    env: {
      PYMTHOUSE_ISSUER_URL: 'https://pymthouse.com/api/v1/oidc',
      PYMTHOUSE_PUBLIC_CLIENT_ID: 'app_98575870d7ae33589a3f0660',
      PYMTHOUSE_API_KEY: 'app_98575870d7ae33589a3f0660_pmth_simulatedsecret',
    },
    routing: proxyRouting,
  },
  {
    name: 'missing core env (readApiKeySignerSessionConfig null) + createPymthouseApiKey fail',
    env: {},
    routing: goodRouting,
    externalUserId: 'user-1',
    createKeyOk: false,
  },
];

for (const s of scenarios) {
  const cfg = readApiKeySignerSessionConfig(s.env);
  try {
    const out = simulateResolve(cfg, s.routing, {
      externalUserId: s.externalUserId,
      createKeyOk: s.createKeyOk !== false,
    });
    console.log(`PASS  ${s.name}`);
    console.log(`      → path=${out.path} url=${out.url} bearer=${out.bearerKind}`);
  } catch (e) {
    console.log(`THROW ${s.name}`);
    console.log(`      → ${e instanceof Error ? e.message : e}`);
  }
  console.log('');
}

// Optional live M2M probe (secrets from env only; never printed)
const issuer = process.env.PYMTHOUSE_ISSUER_URL?.trim();
const pub = process.env.PYMTHOUSE_PUBLIC_CLIENT_ID?.trim();
const m2mId = process.env.PYMTHOUSE_M2M_CLIENT_ID?.trim();
const m2mSecret = process.env.PYMTHOUSE_M2M_CLIENT_SECRET?.trim();

if (issuer && pub && m2mId && m2mSecret) {
  console.log('=== live M2M probe (env present) ===\n');
  const basic = Buffer.from(`${m2mId}:${m2mSecret}`).toString('base64');
  const origin = issuer.replace(/\/api\/v1\/oidc\/?$/i, '').replace(/\/+$/, '');
  const url = `${origin}/api/v1/apps/${encodeURIComponent(pub)}/signer/routing`;
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Basic ${basic}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.json();
    if (!res.ok) {
      console.log(`getSignerRouting: HTTP ${res.status} ${body.error_description ?? body.error ?? ''}`);
    } else {
      const dmz = resolveDmzUrl(body);
      console.log(`getSignerRouting: OK dmz=${dmz}`);
      console.log(`directDmz.signerApiUrl=${body.patterns?.directDmz?.signerApiUrl ?? '(empty)'}`);
    }
  } catch (e) {
    console.log(`getSignerRouting: FAIL ${e instanceof Error ? e.message : e}`);
  }
} else {
  console.log('=== live M2M probe skipped (set PYMTHOUSE_ISSUER_URL, PUBLIC_CLIENT_ID, M2M_* env) ===');
}
