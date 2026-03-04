/**
 * Service Gateway — Scope Abstraction
 *
 * Centralizes the personal/team scope convention to eliminate
 * duplicated `personal:` prefix logic across gateway modules.
 */

export type Scope =
  | { type: 'team'; teamId: string }
  | { type: 'personal'; userId: string };

const PERSONAL_PREFIX = 'personal:';

export function scopeId(scope: Scope): string {
  return scope.type === 'team' ? scope.teamId : `${PERSONAL_PREFIX}${scope.userId}`;
}

export function parseScope(raw: string): Scope {
  if (raw.startsWith(PERSONAL_PREFIX)) {
    return { type: 'personal', userId: raw.slice(PERSONAL_PREFIX.length) };
  }
  return { type: 'team', teamId: raw };
}

export function isPersonalScope(raw: string): boolean {
  return raw.startsWith(PERSONAL_PREFIX);
}

export function personalScopeId(userId: string): string {
  return `${PERSONAL_PREFIX}${userId}`;
}

export function scopeFilter(connectorId: string, raw: string) {
  const scope = parseScope(raw);
  if (scope.type === 'personal') {
    return { id: connectorId, ownerUserId: scope.userId };
  }
  return { id: connectorId, teamId: scope.teamId };
}

export function scopeOwnerWhere(raw: string) {
  const scope = parseScope(raw);
  if (scope.type === 'personal') {
    return { ownerUserId: scope.userId };
  }
  return { teamId: scope.teamId };
}
