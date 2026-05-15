const DEFAULT_PMTHOUSE_ORIGIN = 'https://pymthouse.com';

/**
 * PymtHouse HTTP signer base for python-gateway SDK tokens (`signer` JSON field).
 *
 * Set at build/dev time via `PMTHOUSE_BASE_URL` (see `frontend/vite.config.ts`).
 * Empty / unset falls back to {@link DEFAULT_PMTHOUSE_ORIGIN}.
 */
export function getPymthouseSignerBaseUrl(): string {
  const raw = (import.meta.env.PMTHOUSE_BASE_URL as string | undefined)?.trim() || '';
  const origin = (raw || DEFAULT_PMTHOUSE_ORIGIN).replace(/\/+$/, '');
  return `${origin}/api/signer`;
}
