export const BILLING_PROVIDERS = [
  {
    slug: 'daydream',
    displayName: 'Daydream',
    description: 'Real-time AI video generation',
    icon: 'Cloud',
    authType: 'oauth',
    enabled: true,
    sortOrder: 0,
    // Legacy OAuth configuration
    oidcIssuer: process.env.DAYDREAM_OIDC_ISSUER || 'http://localhost:3001',
    oidcClientId: process.env.DAYDREAM_OIDC_CLIENT_ID || 'naap',
    oidcClientSecret: process.env.DAYDREAM_OIDC_CLIENT_SECRET || undefined,
    oidcScopes: 'openid profile email plan entitlements',
    oidcDiscoveryUrl: process.env.DAYDREAM_OIDC_DISCOVERY_URL || 'http://localhost:3001/.well-known/openid-configuration',
  },
  {
    slug: 'pymthouse',
    displayName: 'Pymthouse',
    description: 'Primary identity provider using OAuth 2.0 / OIDC',
    icon: 'Shield',
    authType: 'oidc',
    enabled: true,
    sortOrder: 1,
    oidcIssuer: process.env.PYMTHOUSE_OIDC_ISSUER || 'http://localhost:3001',
    oidcClientId: process.env.PYMTHOUSE_OIDC_CLIENT_ID || 'naap',
    oidcClientSecret: process.env.PYMTHOUSE_OIDC_CLIENT_SECRET || undefined,
    oidcScopes: process.env.PYMTHOUSE_OIDC_SCOPES || 'openid profile email plan entitlements',
    oidcDiscoveryUrl:
      process.env.PYMTHOUSE_OIDC_DISCOVERY_URL ||
      'http://localhost:3001/.well-known/openid-configuration',
  },
] as const;

export type BillingProviderConfig = (typeof BILLING_PROVIDERS)[number];
