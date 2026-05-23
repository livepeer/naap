/**
 * Server-only entry for `@pymthouse/builder-sdk` (M2M secrets must not ship to the browser).
 * Route handlers and server libs import from here, not from `@pymthouse/builder-sdk/env` directly.
 */

import 'server-only';

import { createPmtHouseClientFromEnv } from '@pymthouse/builder-sdk/env';
import type { PmtHouseClient } from '@pymthouse/builder-sdk';

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
