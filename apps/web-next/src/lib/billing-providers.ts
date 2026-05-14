/**
 * Server-side allowlist of billing providers that use a browser-redirect OAuth
 * flow, along with the trusted authorization URL for each. Resolving the
 * provider URL on the server (and only ever sending the client a same-origin
 * redirector path) prevents Open Redirect via a tampered upstream response.
 */

export interface BillingProviderRedirectConfig {
  readonly providerSlug: string;
  readonly authUrl: string;
}

const DAYDREAM_AUTH_URL =
  process.env.DAYDREAM_AUTH_URL || 'https://app.daydream.live/sign-in/local';

const REDIRECT_FLOW_BILLING_PROVIDERS: Readonly<Record<string, BillingProviderRedirectConfig>> = {
  daydream: { providerSlug: 'daydream', authUrl: DAYDREAM_AUTH_URL },
};

export function getRedirectFlowBillingProvider(
  providerSlug: string,
): BillingProviderRedirectConfig | null {
  return REDIRECT_FLOW_BILLING_PROVIDERS[providerSlug] ?? null;
}

export function isRedirectFlowBillingProvider(providerSlug: string): boolean {
  return Object.prototype.hasOwnProperty.call(REDIRECT_FLOW_BILLING_PROVIDERS, providerSlug);
}
