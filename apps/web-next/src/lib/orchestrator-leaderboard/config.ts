/**
 * Orchestrator Leaderboard — Plugin Config (singleton)
 *
 * Stores admin-configurable refresh interval and last-refresh metadata
 * in a single DB row (upsert pattern). The cron endpoint reads the
 * interval to decide whether to refresh the global dataset.
 */

import { prisma } from '@/lib/db';

const SINGLETON_ID = 'singleton';
const ALLOWED_INTERVALS = [1, 4, 8, 12] as const;

export type AllowedInterval = (typeof ALLOWED_INTERVALS)[number];

export interface LeaderboardConfigDTO {
  refreshIntervalHours: number;
  lastRefreshedAt: string | null;
  lastRefreshedBy: string | null;
  updatedAt: string;
}

function toDTO(row: {
  refreshIntervalHours: number;
  lastRefreshedAt: Date | null;
  lastRefreshedBy: string | null;
  updatedAt: Date;
}): LeaderboardConfigDTO {
  return {
    refreshIntervalHours: row.refreshIntervalHours,
    lastRefreshedAt: row.lastRefreshedAt?.toISOString() ?? null,
    lastRefreshedBy: row.lastRefreshedBy,
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function isValidInterval(value: unknown): value is AllowedInterval {
  return typeof value === 'number' && (ALLOWED_INTERVALS as readonly number[]).includes(value);
}

/**
 * Read the singleton config row, creating it with defaults if missing.
 */
export async function getConfig(): Promise<LeaderboardConfigDTO> {
  const row = await prisma.leaderboardConfig.upsert({
    where: { id: SINGLETON_ID },
    update: {},
    create: { id: SINGLETON_ID },
  });
  return toDTO(row);
}

/**
 * Update the refresh interval. Validates against allowed tiers.
 */
export async function updateConfig(
  intervalHours: number,
): Promise<LeaderboardConfigDTO> {
  if (!isValidInterval(intervalHours)) {
    throw new Error(
      `refreshIntervalHours must be one of: ${ALLOWED_INTERVALS.join(', ')}`,
    );
  }

  const row = await prisma.leaderboardConfig.upsert({
    where: { id: SINGLETON_ID },
    update: { refreshIntervalHours: intervalHours },
    create: { id: SINGLETON_ID, refreshIntervalHours: intervalHours },
  });
  return toDTO(row);
}

/**
 * Returns the configured refresh interval in milliseconds.
 */
export async function getRefreshIntervalMs(): Promise<number> {
  const config = await getConfig();
  return config.refreshIntervalHours * 3_600_000;
}

/**
 * Record that a refresh just completed, persisting the known capability list.
 */
export async function markRefreshed(by: string, capabilities?: string[]): Promise<void> {
  const data: Record<string, unknown> = {
    lastRefreshedAt: new Date(),
    lastRefreshedBy: by,
  };
  if (capabilities) {
    data.knownCapabilities = capabilities;
  }
  await prisma.leaderboardConfig.upsert({
    where: { id: SINGLETON_ID },
    update: data,
    create: { id: SINGLETON_ID, ...data },
  });
}

/**
 * Read persisted capabilities from the DB (survives serverless cold starts).
 */
export async function getKnownCapabilities(): Promise<string[]> {
  try {
    const row = await prisma.leaderboardConfig.findUnique({
      where: { id: SINGLETON_ID },
      select: { knownCapabilities: true },
    });
    return row?.knownCapabilities ?? [];
  } catch {
    return [];
  }
}
