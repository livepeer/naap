// Callback origin: the public-facing NaaP base URL used in OAuth/OIDC redirect_uri values.
// Update this when your NaaP app runs on a different origin (e.g. production).
const DEFAULT_CALLBACK_ORIGIN = 'http://localhost:3000';

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
    callbackOrigin: DEFAULT_CALLBACK_ORIGIN,
  },
  {
    slug: 'pymthouse',
    displayName: 'PymtHouse',
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
    callbackOrigin: DEFAULT_CALLBACK_ORIGIN,
  },
];

export type BillingProviderConfig = {
  slug: string;
  displayName: string;
  description: string;
  icon: string;
  authType: string;
  enabled: boolean;
  sortOrder: number;
  oidcIssuer: string;
  oidcClientId: string;
  oidcClientSecret: string | undefined;
  oidcScopes: string;
  oidcDiscoveryUrl: string;
  callbackOrigin: string | null;
};
