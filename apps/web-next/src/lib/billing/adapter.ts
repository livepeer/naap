/**
 * Billing Provider Adapter SPI (NAAP-A).
 *
 * NaaP reaches every billing provider ONLY through this interface + the registry
 * (`registry.ts`). NaaP code must never import a provider client directly — the
 * reference provider (pymthouse) is wrapped by `PymthouseAdapter` behind this
 * SPI. This is the NaaP-side surface of the Billing Provider Protocol (BPP, C0).
 *
 * Methods that a given provider has not implemented yet throw
 * `AdapterNotImplementedError` (HTTP 501-equivalent) rather than guessing.
 */

/** BPP ② validate result (provider-neutral; mirrors validate.schema.json). */
export interface ValidateResult {
  valid: boolean;
  user?: { sub: string };
  billing_account?: {
    id: string;
    providerSlug: string;
    billingMode: 'delegated' | 'prepay';
  };
  capabilities?: string[];
  quota?: { remaining: number; resetAt?: string } | null;
  /** Neutral opaque subscription pointer — never a provider-internal id name. */
  subscriptionRef?: string;
  signerSession?: SignerSession;
}

/** Provider-issued signer session, opaque to applications. */
export interface SignerSession {
  url?: string;
  headers?: Record<string, string>;
  accessToken?: string;
  tokenType?: string;
  expiresIn?: number;
  scope?: string;
}

/** BPP ④ plan. */
export interface Plan {
  id: string;
  name?: string;
  price?: { amount: number; interval: string; currency?: string };
  bundles: Array<{
    capability: string;
    sla?: { uptime?: number; p95Ms?: number };
    maxPriceWeiPerUnit?: string;
  }>;
}

/** BPP capability manifest entry. */
export interface Capability {
  id: string;
  description?: string;
}

/** Curated orchestrator (BPP ⑧). */
export interface CuratedOrchestrator {
  address: string;
  capabilities: string[];
  score?: number;
}

export interface UsageForExternalUserInput {
  externalUserId: string;
  startDate: string;
  endDate: string;
  maxEndUserIds?: number;
}

export interface AppUsageInput {
  startDate: string;
  endDate: string;
  groupBy?: 'none' | 'user';
  userId?: string;
}

export interface MintSignerSessionInput {
  externalUserId: string;
  email?: string;
}

/**
 * The provider-neutral adapter SPI. Every method maps to a BPP seam.
 */
export interface BillingProviderAdapter {
  /** Provider slug, e.g. "pymthouse" | "stub". */
  readonly slug: string;

  /** Whether this provider has the configuration it needs to serve requests. */
  isConfigured(): boolean;

  /** BPP ② — resolve an opaque key into identity + capabilities + signer session. */
  validate(key: string): Promise<ValidateResult>;

  /** BPP ④ — plan catalogue. */
  getPlans(): Promise<Plan[]>;

  /** BPP usage/telemetry — per-user usage rollup for one external user. */
  getUsageForExternalUser(input: UsageForExternalUserInput): Promise<unknown>;

  /** BPP usage/telemetry — app-wide usage (admin scope). */
  getAppUsage(input: AppUsageInput): Promise<unknown>;

  /** BPP mintSignerSession — provider-issued, opaque to apps. */
  mintSignerSession(input: MintSignerSessionInput): Promise<SignerSession>;

  /** BPP ⑧ — receive a curated orchestrator list for a plan. */
  receiveCuratedOrchestrators(plan: string, list: CuratedOrchestrator[]): Promise<void>;

  /** BPP capability manifest — what this provider can enable. */
  getCapabilityManifest(): Promise<Capability[]>;
}

/** Thrown when a provider has not implemented a BPP method yet. */
export class AdapterNotImplementedError extends Error {
  readonly providerSlug: string;
  readonly method: string;
  constructor(providerSlug: string, method: string) {
    super(`Adapter "${providerSlug}" does not implement "${method}"`);
    this.name = 'AdapterNotImplementedError';
    this.providerSlug = providerSlug;
    this.method = method;
  }
}
