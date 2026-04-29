/**
 * Server-only entry for `@pymthouse/builder-api` (M2M secrets must not ship to the browser).
 * Route handlers and server libs import from here, not from `@pymthouse/builder-api/env` directly.
 */

import 'server-only';

import { createPmtHouseClientFromEnv } from '@pymthouse/builder-api/env';
import type { PmtHouseClient } from '@pymthouse/builder-api';

let cached: PmtHouseClient | null = null;

export function getPmtHouseServerClient(): PmtHouseClient {
  if (!cached) {
    cached = createPmtHouseClientFromEnv();
  }
  return cached;
}

/** Vitest / isolated tests: clear module-level singleton. */
export function resetPmtHouseServerClientForTests(): void {
  cached = null;
}
