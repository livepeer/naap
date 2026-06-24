import type { AuthStrategy, AuthContext } from '../types';

/**
 * `passthrough` auth strategy (NAAP-5 / SDK gateway).
 *
 * A deliberately no-op injector. Unlike every other auth strategy, `passthrough`
 * does NOT mint or inject an upstream credential from connector secrets — the
 * upstream service authenticates the consumer's *own* bearer itself (e.g. the
 * SDK service validates the `naap_` key and mints its own signer/payment
 * tickets). The actual forwarding of the inbound `Authorization` header is done
 * in {@link buildUpstreamRequest} (transform.ts), which is the only place with
 * access to the original consumer request.
 *
 * This strategy exists so the registry resolves `authType: "passthrough"`
 * explicitly (instead of silently falling back to `none`), and so the injection
 * step never strips or overwrites the forwarded header. It is additive: only
 * connectors explicitly configured with `authType: "passthrough"` (today just
 * the flag-gated `sdk` connector) use it; all other connectors are unchanged.
 */
export const passthroughAuth: AuthStrategy = {
  name: 'passthrough',
  inject(_ctx: AuthContext): void {
    // No upstream credential is injected — the consumer's own Authorization
    // header is forwarded verbatim by the transform orchestrator instead.
  },
};
