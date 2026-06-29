/**
 * Key validation front door (NAAP-C) — BPP ③.
 *
 *   POST /api/v1/keys/validate
 *   auth:   Authorization: Bearer naap_…   (native key ONLY — D1, no passthrough)
 *   header: X-App-Id: <appId>              (optional; usage attribution)
 *   → { valid, user, app?, billingAccount, capabilities, quota, signerSession }
 *
 * The SINGLE entry point apps/services (the SDK service) call instead of talking
 * to a provider directly. Resolves naap_ → seat → team → billingAccountRef →
 * provider adapter (NAAP-A). Provider-agnostic: the same request resolves
 * whether the backing provider is pymthouse or the C0 stub.
 *
 * SECURITY: this endpoint performs NO app-controlled outbound fetch. The only
 * provider I/O is through the adapter to the provider's ENV-configured base URL
 * (never a request-derived URL) — so there is no SSRF vector here. X-App-Id is
 * format-validated and used only for attribution (never to build a URL/query).
 *
 * Gated behind the `key_validation_front_door` flag (default OFF): 404 when OFF,
 * so callers fall back to their existing direct path (lag tolerance).
 */

import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

import { prisma } from '@/lib/db';
import { error, errors, success } from '@/lib/api/response';
import { enforceRateLimit } from '@/lib/api/rate-limit';
import { isFeatureEnabled, anyTeamFlagOverrideEnabled, PER_KEY_REMOTE_SIGNER_FLAG } from '@/lib/feature-flags';
import { parseApiKey } from '@naap/database';
import { AdapterNotImplementedError, type SignerSession } from '@/lib/billing/adapter';
import { getBillingProviderAdapter } from '@/lib/billing/registry';
import { resolveKeyProviderBinding } from '@/lib/billing/key-provider-binding';
import { resolveKeyDiscovery } from '@/lib/billing/key-discovery';
import {
  resolveNativeKeyToProviderSession,
  verifyNativeKeyHash,
} from '@/lib/dev-api/native-key';
import {
  FRONT_DOOR_FLAG,
  INVALID_APP_ID,
  buildFrontDoorResponse,
  extractAppId,
  isNativeKeyToken,
  parseBearer,
} from '@/lib/dev-api/validate-key';
import { CAPABILITY_GATE_FLAG, enforceCapabilityGate } from '@/lib/capabilities/enforcement';

const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX = 120;

function noStore(res: NextResponse): NextResponse {
  res.headers.set('Cache-Control', 'no-store');
  return res;
}

function correlationIdOf(request: NextRequest): string {
  return request.headers.get('x-request-id')?.trim() || randomUUID();
}

function log(level: 'info' | 'warn' | 'error', event: string, fields: Record<string, unknown>): void {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}

/** Uniform invalid-key response (no enumeration / no reason leak). */
function invalid(correlationId: string, reason: string): NextResponse {
  log('warn', 'keys.validate.invalid', { correlationId, reason });
  return noStore(error('INVALID_KEY', 'Invalid or unauthorized key', 401));
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const correlationId = correlationIdOf(request);
  try {
    // Front-door visibility gate (team-scoped). Globally ON → today's exact path
    // (short-circuits, no extra query). Globally OFF + NO team opted in → 404
    // immediately, byte-identical to today. Globally OFF but some team has an
    // override ON → continue so we can resolve the key's team and re-evaluate in
    // that team's scope below (a non-enabled team is masked back to 404).
    const globalFrontDoor = await isFeatureEnabled(FRONT_DOOR_FLAG);
    if (!globalFrontDoor && !(await anyTeamFlagOverrideEnabled(FRONT_DOOR_FLAG))) {
      return noStore(errors.notFound('Resource'));
    }

    const rateLimited = enforceRateLimit(request, {
      keyPrefix: 'keys-validate',
      windowMs: RATE_LIMIT_WINDOW_MS,
      maxRequests: RATE_LIMIT_MAX,
    });
    if (rateLimited) return rateLimited;

    const token = parseBearer(request.headers.get('authorization'));
    if (!token) return invalid(correlationId, 'no_bearer');

    // D1: native naap_ keys ONLY — provider-token passthrough is disabled.
    if (!isNativeKeyToken(token)) {
      return invalid(correlationId, 'provider_token_passthrough_disabled');
    }

    const appId = extractAppId(request.headers.get('x-app-id'));
    if (appId === INVALID_APP_ID) {
      return noStore(errors.badRequest('Invalid X-App-Id'));
    }

    const parsed = parseApiKey(token);
    if (!parsed) return invalid(correlationId, 'malformed');

    const key = await prisma.devApiKey.findUnique({
      where: { keyLookupId: parsed.lookupId },
      select: {
        id: true,
        userId: true,
        keyHash: true,
        status: true,
        seatId: true,
        teamId: true,
        subscriptionId: true,
      },
    });
    // Constant-time hash check; uniform failure whether the row is missing or
    // the secret mismatches (no key enumeration).
    if (!key || !verifyNativeKeyHash(token, key.keyHash)) {
      return invalid(correlationId, 'not_found_or_mismatch');
    }
    if (key.status !== 'ACTIVE') {
      return invalid(correlationId, 'revoked');
    }

    // Per-team front-door re-check, now that we know the key's owning team.
    // Resolves the flag in THIS team's scope: a per-team override (ON or OFF)
    // wins, else the team inherits the global value — so a non-opted-in team is
    // masked back to 404 (endpoint stays hidden for it, exactly as today). The
    // override fetch is cached and reused by every team-scoped flag check below,
    // so this adds no extra DB round-trip on the hot path. With NO override the
    // result equals the global value (zero regression).
    const teamId = key.teamId;
    if (!(await isFeatureEnabled(FRONT_DOOR_FLAG, teamId))) {
      return noStore(errors.notFound('Resource'));
    }

    // Resolve the seat's team binding.
    const team = key.teamId
      ? await prisma.team.findUnique({
          where: { id: key.teamId },
          select: { id: true, billingAccountProviderSlug: true, billingAccountId: true },
        })
      : null;

    // P2: resolve the per-key subscription hop. `multi_subscription` OFF or a
    // null `subscriptionId` ⇒ `legacy`, so the native-key resolver + capability
    // lookup below take today's exact team-account / global-env path. ON + a
    // linked, active, same-team subscription ⇒ a per-instance adapter scoped to
    // the subscription's account (per-key auth/capabilities/usage). Never
    // hard-fails: missing/inactive/unresolved ⇒ legacy.
    const binding = await resolveKeyProviderBinding({
      subscriptionId: key.subscriptionId,
      teamId: key.teamId,
    });

    const resolved = await resolveNativeKeyToProviderSession(
      { status: key.status, seatId: key.seatId, teamId: key.teamId },
      team,
      binding.mode === 'subscription'
        ? { override: { adapter: binding.adapter, billingAccountRef: binding.billingAccountRef } }
        : undefined,
    );
    if (!resolved.valid || !resolved.signerSession || !resolved.billingAccountRef) {
      // Map fail-safe reasons: provider lag → 503; binding issues → 403.
      if (resolved.reason === 'provider_unavailable' || resolved.reason === 'mint_failed') {
        log('warn', 'keys.validate.provider_unavailable', { correlationId, reason: resolved.reason });
        return noStore(errors.serviceUnavailable('Billing provider unavailable'));
      }
      if (resolved.reason === 'team_unbound' || resolved.reason === 'unbound_seat') {
        return noStore(errors.forbidden('Key is not bound to a billing account'));
      }
      return invalid(correlationId, resolved.reason ?? 'unresolved');
    }

    const ref = resolved.billingAccountRef;

    // Capability resolution AND the optional per-key signer-endpoint resolution
    // both scope to the SAME adapter/account the signer was minted against: the
    // per-instance adapter in subscription mode, else today's slug→adapter.
    const adapter =
      binding.mode === 'subscription' ? binding.adapter : getBillingProviderAdapter(ref.providerSlug);

    // Per-key remote signer (default OFF → byte-for-byte today's response). When
    // ON and the resolved adapter can expose a remote signer DMZ, swap the
    // provider token-bundle session for the SignerSession ENDPOINT form
    // { url, headers } so the SDK service signs + pays through the funded
    // per-key wallet. Fails SAFE: any resolution error keeps the token-bundle
    // form (the SDK service falls back to its static signer), never 500s.
    let signerSession: SignerSession = resolved.signerSession;
    if (
      adapter?.resolveSignerEndpoint &&
      (await isFeatureEnabled(PER_KEY_REMOTE_SIGNER_FLAG, teamId))
    ) {
      try {
        signerSession = await adapter.resolveSignerEndpoint(resolved.signerSession, {
          externalUserId: ref.accountId,
        });
        log('info', 'keys.validate.signer_endpoint', {
          correlationId,
          providerSlug: ref.providerSlug,
        });
      } catch {
        log('warn', 'keys.validate.signer_endpoint_unavailable', {
          correlationId,
          providerSlug: ref.providerSlug,
        });
      }
    }

    // Best-effort capabilities/quota from the provider (BPP ②). When the
    // provider hasn't wired validate yet (AdapterNotImplementedError), fail
    // CLOSED to an empty capability set — the key is still valid; NAAP-E gates.
    let capabilities: string[] = [];
    let quota: { remaining: number; resetAt?: string } | null = null;
    if (adapter) {
      try {
        const v = await adapter.validate(ref.accountId, { teamId });
        if (Array.isArray(v.capabilities)) capabilities = v.capabilities;
        quota = v.quota ?? null;
      } catch (e) {
        if (!(e instanceof AdapterNotImplementedError)) {
          log('warn', 'keys.validate.capabilities_unavailable', {
            correlationId,
            providerSlug: ref.providerSlug,
          });
        }
      }
    }

    // NAAP-E capability gate. Default OFF → pure pass-through (response is
    // exactly as before). ON → an optional `X-Requested-Capability` the resolved
    // plan does not grant is denied (fail closed; an empty grant set denies all).
    const gate = enforceCapabilityGate({
      enabled: await isFeatureEnabled(CAPABILITY_GATE_FLAG, teamId),
      granted: capabilities,
      requested: request.headers.get('x-requested-capability'),
    });
    if (!gate.allowed) {
      log('warn', 'keys.validate.capability_denied', {
        correlationId,
        providerSlug: ref.providerSlug,
        reason: gate.reason,
      });
      return noStore(errors.forbidden('Requested capability not granted'));
    }

    // P4: select the per-app discovery this key is matched to
    // (key → subscription → ProviderPlan → DiscoveryPlan). Reachable only in
    // subscription mode AND when `plan_spec_sync` is ON with a synced plan;
    // otherwise null ⇒ no `discovery` field ⇒ byte-for-byte today's response.
    const resolvedDiscovery =
      binding.mode === 'subscription'
        ? await resolveKeyDiscovery(binding.subscription, teamId)
        : null;
    const discovery = resolvedDiscovery
      ? { planId: resolvedDiscovery.discoveryPlanId, url: resolvedDiscovery.url }
      : null;

    // Fire-and-forget last-used update; never block validation on it.
    prisma.devApiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } }).catch(() => {});

    const body = buildFrontDoorResponse({
      userSub: key.userId,
      appId: appId ?? undefined,
      billingAccountRef: ref,
      capabilities,
      quota,
      signerSession,
      discovery,
    });

    log('info', 'keys.validate.ok', {
      correlationId,
      keyId: key.id,
      providerSlug: ref.providerSlug,
      hasApp: Boolean(appId),
      capabilityCount: capabilities.length,
      subscriptionScoped: binding.mode === 'subscription',
      hasDiscovery: Boolean(discovery),
    });
    return noStore(success(body));
  } catch (err) {
    log('error', 'keys.validate.error', {
      correlationId,
      message: err instanceof Error ? err.message : 'unknown',
    });
    return noStore(errors.internal('Validation failed'));
  }
}
