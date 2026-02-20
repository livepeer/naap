/**
 * In-memory session store for billing-provider OAuth auth handoff.
 *
 * Stores short-lived login sessions that correlate:
 *   gateway <-> browser (provider OAuth) <-> NAAP callback
 *
 * Sessions auto-expire after their TTL. In production this should
 * move to Redis or the NAAP database for HA/multi-instance.
 * TODO: Replace this map with shared persistent storage before production
 * usage on multi-instance serverless runtimes (e.g. Vercel).
 */

export interface BillingProviderLoginSession {
  loginSessionId: string;
  providerSlug: string;
  gatewayNonce: string;
  gatewayInstanceId: string | null;
  naapUserId: string | null;
  state: string;
  status: 'pending' | 'complete' | 'expired' | 'denied';
  accessToken: string | null;
  userId: string | null;
  createdAt: number;
  expiresAt: number;
  redeemed: boolean;
}

/**
 * Simple in-memory store with periodic cleanup.
 * Keys are either a loginSessionId or `state:{stateNonce}` for reverse lookup.
 */
class LoginSessionStore {
  private store: Map<string, BillingProviderLoginSession>;

  constructor() {
    const globalStore = globalThis as typeof globalThis & {
      __naapBillingProviderLoginSessionStore?: Map<string, BillingProviderLoginSession>;
      __naapBillingProviderLoginSessionCleanup?: ReturnType<typeof setInterval>;
    };
    if (!globalStore.__naapBillingProviderLoginSessionStore) {
      globalStore.__naapBillingProviderLoginSessionStore =
        new Map<string, BillingProviderLoginSession>();
    }
    this.store = globalStore.__naapBillingProviderLoginSessionStore;

    // Clean up expired sessions every 60 seconds
    if (!globalStore.__naapBillingProviderLoginSessionCleanup) {
      globalStore.__naapBillingProviderLoginSessionCleanup = setInterval(() => this.cleanup(), 60_000);
    }
  }

  get(key: string): BillingProviderLoginSession | undefined {
    const session = this.store.get(key);
    if (session && Date.now() > session.expiresAt) {
      this.store.delete(key);
      this.store.delete(`state:${session.state}`);
      return undefined;
    }
    return session;
  }

  set(key: string, session: BillingProviderLoginSession): void {
    this.store.set(key, session);
  }

  delete(key: string): void {
    const session = this.store.get(key);
    this.store.delete(key);
    if (!session) {
      return;
    }

    if (key.startsWith('state:')) {
      this.store.delete(session.loginSessionId);
      return;
    }

    this.store.delete(`state:${session.state}`);
  }

  markRedeemed(key: string): boolean {
    const session = this.get(key);
    if (!session || session.redeemed) {
      return false;
    }
    session.redeemed = true;
    this.store.set(key, session);
    return true;
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, session] of this.store) {
      if (key.startsWith('state:')) {
        const primary = this.store.get(session.loginSessionId);
        if (!primary || now > session.expiresAt || now > primary.expiresAt) {
          this.store.delete(key);
        }
        continue;
      }
      if (now > session.expiresAt) {
        this.store.delete(key);
        this.store.delete(`state:${session.state}`);
      }
    }
  }
}

export const billingProviderLoginSessions = new LoginSessionStore();
