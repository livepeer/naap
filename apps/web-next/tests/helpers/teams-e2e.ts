import type { Browser } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';

const AUTH_REL = path.join(process.cwd(), 'playwright', '.auth', 'user.json');

function envTruthy(v: string | undefined): boolean {
  if (!v) return false;
  return ['1', 'true', 'yes'].includes(v.trim().toLowerCase());
}

/** Force-skip teams E2E (e.g. CI) regardless of remote feature flags. */
export function e2eSkipTeamsFromEnv(): boolean {
  return envTruthy(process.env.E2E_SKIP_TEAMS);
}

/**
 * When enableTeams is false on the server, teams UI tests should not run.
 * Uses the same storage state as chromium tests (written by auth.setup).
 */
export async function teamsFeatureDisabledRemote(
  browser: Browser,
  baseURL: string | undefined,
): Promise<boolean> {
  if (!baseURL || !fs.existsSync(AUTH_REL)) return false;

  const context = await browser.newContext({ storageState: AUTH_REL });
  try {
    const res = await context.request.get(`${baseURL}/api/v1/features`);
    if (!res.ok()) return false;
    const json = (await res.json()) as { success?: boolean; data?: { flags?: Record<string, boolean> } };
    if (!json?.success || !json.data?.flags) return false;
    return json.data.flags.enableTeams === false;
  } finally {
    await context.close();
  }
}
