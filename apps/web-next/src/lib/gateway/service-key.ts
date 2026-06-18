/**
 * Service Gateway — Discovery-scoped service keys (NAAP-4).
 *
 * Mints a service-level `gw_` key that the SDK service (and other infra
 * consumers) use to reach NaaP discovery
 * (`GET /api/v1/orchestrator-leaderboard/python-gateway`).
 *
 * The key is a normal `gatewayApiKey` row — `authorize()` already accepts
 * `gw_` keys — but it is scoped to the discovery endpoint via `allowedEndpoints`.
 * Existing keys carry an empty `allowedEndpoints` ("all endpoints"), so minting a
 * scoped service key is purely additive and changes no existing key's behavior
 * (zero regression). The `keyAllowsDiscovery` helper is exported for downstream
 * scope enforcement (e.g. INFRA-2) without coupling it to the live route here.
 */

import { randomBytes, createHash } from 'crypto';
import { prisma } from '@/lib/db';

/** Canonical discovery endpoint a service key is scoped to (BPP ⑦). */
export const DISCOVERY_ENDPOINT = '/api/v1/orchestrator-leaderboard/python-gateway';

export interface MintServiceDiscoveryKeyInput {
  /** Human-readable label for the key. */
  name: string;
  /** Acting user id (audit: who created the key). */
  createdBy: string;
  /** Team-scoped key owner. Provide exactly one of teamId / ownerUserId. */
  teamId?: string;
  /** Personal-scoped key owner. Provide exactly one of teamId / ownerUserId. */
  ownerUserId?: string;
  /** Optional extra endpoints the service key may reach, in addition to discovery. */
  additionalEndpoints?: string[];
  /** Optional expiry. */
  expiresAt?: Date | null;
}

export interface MintedServiceDiscoveryKey {
  id: string;
  keyPrefix: string;
  /** Raw key — returned exactly ONCE, never persisted in plaintext. */
  rawKey: string;
  allowedEndpoints: string[];
}

/**
 * True when a key's `allowedEndpoints` permit the discovery endpoint.
 *
 * An empty allowlist means "all endpoints" (current behavior for every existing
 * key), so it always permits discovery — keeping enforcement a no-op until a key
 * is explicitly minted with a non-empty scope.
 */
export function keyAllowsDiscovery(allowedEndpoints: string[] | undefined): boolean {
  if (!allowedEndpoints || allowedEndpoints.length === 0) return true;
  return allowedEndpoints.includes(DISCOVERY_ENDPOINT);
}

/**
 * Mint a service-level `gw_` key scoped to discovery for an SDK service.
 *
 * The scope is recorded as `allowedEndpoints`; the raw key is returned once and
 * only its SHA-256 hash is stored.
 */
export async function mintServiceDiscoveryKey(
  input: MintServiceDiscoveryKeyInput,
): Promise<MintedServiceDiscoveryKey> {
  const hasTeam = Boolean(input.teamId);
  const hasOwner = Boolean(input.ownerUserId);
  if (hasTeam === hasOwner) {
    throw new Error('mintServiceDiscoveryKey: provide exactly one of teamId or ownerUserId');
  }

  const allowedEndpoints = Array.from(
    new Set([DISCOVERY_ENDPOINT, ...(input.additionalEndpoints ?? [])]),
  );

  const rawKey = `gw_${randomBytes(32).toString('hex')}`;
  const keyHash = createHash('sha256').update(rawKey).digest('hex');
  const keyPrefix = rawKey.slice(0, 11);

  const ownerData = hasTeam
    ? { teamId: input.teamId! }
    : { ownerUserId: input.ownerUserId! };

  const created = await prisma.gatewayApiKey.create({
    data: {
      ...ownerData,
      createdBy: input.createdBy,
      name: input.name,
      keyHash,
      keyPrefix,
      allowedEndpoints,
      allowedIPs: [],
      expiresAt: input.expiresAt ?? null,
    },
    select: { id: true, keyPrefix: true },
  });

  return { id: created.id, keyPrefix: created.keyPrefix, rawKey, allowedEndpoints };
}
