/**
 * DB-backed Application resolution (NAAP-D) for the validation front door.
 *
 * Kept separate from `registry.ts` (which is intentionally DB-free) so the
 * scope/capability logic stays unit-testable in isolation. The front door
 * (NAAP-C) calls this to registry-check the `X-App-Id` it was presented.
 */

import { prisma } from '@/lib/db';
import type { RegisteredApp } from './registry';

/**
 * Resolve a presented `X-App-Id` to a registered `Application`. The header may
 * carry either the app's `id` (uuid) or its `slug`; both are accepted so apps
 * can present a human-friendly slug. Returns `null` when nothing matches.
 */
export async function resolveRegisteredApp(appId: string): Promise<RegisteredApp | null> {
  const row = await prisma.application.findFirst({
    where: { OR: [{ id: appId }, { slug: appId }] },
    select: {
      id: true,
      slug: true,
      type: true,
      teamId: true,
      ownerUserId: true,
      allowedScopes: true,
      allowedCapabilities: true,
      status: true,
    },
  });
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    type: row.type as RegisteredApp['type'],
    teamId: row.teamId,
    ownerUserId: row.ownerUserId,
    allowedScopes: row.allowedScopes,
    allowedCapabilities: row.allowedCapabilities,
    status: row.status,
  };
}

/**
 * Decide whether a resolved key (its team + user) is permitted to act as the
 * given registered app. Team-scoped apps must match the key's team; personal
 * apps must be owned by the key's user. Provider-agnostic.
 */
export function appBelongsToKeyScope(
  app: Pick<RegisteredApp, 'teamId' | 'ownerUserId'>,
  keyScope: { teamId: string | null; userId: string },
): boolean {
  if (app.teamId) return app.teamId === keyScope.teamId;
  if (app.ownerUserId) return app.ownerUserId === keyScope.userId;
  return false;
}
