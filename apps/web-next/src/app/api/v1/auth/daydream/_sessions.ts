/**
 * In-memory session store for Daydream brokered auth handoff.
 *
 * Stores short-lived login sessions that correlate:
 *   gateway (Scope) <-> browser (Daydream OAuth) <-> NAAP callback
 *
 * Sessions auto-expire after their TTL. In production this should
 * move to Redis or the NAAP database for HA/multi-instance.
 */

export interface DaydreamLoginSession {
  loginSessionId: string;
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
  private store: Map<string, DaydreamLoginSession>;

  constructor() {
    const globalStore = globalThis as typeof globalThis & {
      __naapDaydreamLoginSessionStore?: Map<string, DaydreamLoginSession>;
      __naapDaydreamLoginSessionCleanup?: ReturnType<typeof setInterval>;
    };
    if (!globalStore.__naapDaydreamLoginSessionStore) {
      globalStore.__naapDaydreamLoginSessionStore = new Map<string, DaydreamLoginSession>();
    }
    this.store = globalStore.__naapDaydreamLoginSessionStore;

    // Clean up expired sessions every 60 seconds
    if (!globalStore.__naapDaydreamLoginSessionCleanup) {
      globalStore.__naapDaydreamLoginSessionCleanup = setInterval(
        () => this.cleanup(),
        60_000
      );
    }
  }

  get(key: string): DaydreamLoginSession | undefined {
    const session = this.store.get(key);
    if (session && Date.now() > session.expiresAt) {
      this.store.delete(key);
      this.store.delete(`state:${session.state}`);
      return undefined;
    }
    return session;
  }

  set(key: string, session: DaydreamLoginSession): void {
    this.store.set(key, session);
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, session] of this.store) {
      if (now > session.expiresAt) {
        this.store.delete(key);
      }
    }
  }
}

export const daydreamLoginSessions = new LoginSessionStore();
