export const BILLING_PROVIDERS = [
  {
    slug: 'daydream',
    displayName: 'Daydream',
    description: 'Real-time AI video generation',
    icon: 'Cloud',
    authType: 'oidc',
    enabled: true,
    sortOrder: 0,
    // OIDC configuration - pymthouse as identity provider
    oidcIssuer: process.env.DAYDREAM_OIDC_ISSUER || 'http://localhost:3001',
    oidcClientId: process.env.DAYDREAM_OIDC_CLIENT_ID || 'naap',
    oidcClientSecret: process.env.DAYDREAM_OIDC_CLIENT_SECRET || undefined,
    oidcScopes: 'openid profile email plan entitlements',
    oidcDiscoveryUrl: process.env.DAYDREAM_OIDC_DISCOVERY_URL || 'http://localhost:3001/.well-known/openid-configuration',
  },
] as const;

export type BillingProviderConfig = (typeof BILLING_PROVIDERS)[number];
