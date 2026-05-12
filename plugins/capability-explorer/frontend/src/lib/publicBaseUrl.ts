import { getShellContext } from '@naap/plugin-utils/auth';

export const CAPABILITY_EXPLORER_API_PATH = '/api/v1/capability-explorer';

function normalizePublicOrigin(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, '');
  if (!trimmed) return '';
  try {
    const withProto = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
    return new URL(withProto).origin;
  } catch {
    return trimmed;
  }
}

/**
 * Canonical browser origin for absolute explorer URLs (GraphQL docs, copy-to-curl).
 * Uses shell-injected `publicAppUrl` when present (from NEXT_PUBLIC_BASE_URL / NEXT_PUBLIC_APP_URL in PluginLoader).
 */
export function getPublicAppOrigin(): string {
  if (typeof window === 'undefined') return '';
  const fromShell = getShellContext()?.config?.publicAppUrl;
  if (typeof fromShell === 'string' && fromShell.trim()) {
    return normalizePublicOrigin(fromShell);
  }
  return window.location.origin;
}

export function getCapabilityExplorerGraphqlHttpUrl(): string {
  return `${getPublicAppOrigin()}${CAPABILITY_EXPLORER_API_PATH}/graphql`;
}
