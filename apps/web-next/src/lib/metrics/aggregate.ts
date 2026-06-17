/**
 * Cross-provider usage aggregation (NAAP-2).
 *
 * Aggregates ingested BPP ⑥ usage records into a spend view keyed by provider
 * (the "provider column"), so a dashboard can show spend across ANY number of
 * billing providers side by side. Pure, DB-free logic for unit testing.
 *
 * Monetary fields (`feeWei`, `networkFeeUsdMicros`) are decimal strings of
 * unbounded magnitude; sums use BigInt to avoid float precision loss.
 */

/** Minimal shape of a stored/ingested usage record needed for aggregation. */
export interface UsageRecordLike {
  providerSlug: string;
  accountId: string;
  appId?: string | null;
  sessions?: number | null;
  tickets?: number | null;
  feeWei?: string | null;
  networkFeeUsdMicros?: string | null;
}

/** One row of the cross-provider spend view. */
export interface ProviderSpendRow {
  providerSlug: string;
  sessions: number;
  tickets: number;
  /** Decimal wei string (BigInt sum). */
  feeWei: string;
  /** Decimal USD-micros string (BigInt sum). */
  networkFeeUsdMicros: string;
  /** Distinct accounts seen for this provider. */
  accounts: number;
  /** Distinct apps seen for this provider (excludes records with no appId). */
  apps: number;
}

function addDecimal(acc: bigint, value: string | null | undefined): bigint {
  if (!value) return acc;
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`aggregate: non-decimal monetary value "${value}"`);
  }
  return acc + BigInt(value);
}

interface Accumulator {
  sessions: number;
  tickets: number;
  feeWei: bigint;
  networkFeeUsdMicros: bigint;
  accounts: Set<string>;
  apps: Set<string>;
}

/**
 * Aggregate usage records into one row per provider, sorted by provider slug for
 * stable output. Works for ≥1 providers (cross-provider when ≥2).
 */
export function aggregateSpendByProvider(records: UsageRecordLike[]): ProviderSpendRow[] {
  const byProvider = new Map<string, Accumulator>();

  for (const r of records) {
    let acc = byProvider.get(r.providerSlug);
    if (!acc) {
      acc = {
        sessions: 0,
        tickets: 0,
        feeWei: 0n,
        networkFeeUsdMicros: 0n,
        accounts: new Set(),
        apps: new Set(),
      };
      byProvider.set(r.providerSlug, acc);
    }
    acc.sessions += r.sessions ?? 0;
    acc.tickets += r.tickets ?? 0;
    acc.feeWei = addDecimal(acc.feeWei, r.feeWei);
    acc.networkFeeUsdMicros = addDecimal(acc.networkFeeUsdMicros, r.networkFeeUsdMicros);
    acc.accounts.add(r.accountId);
    if (r.appId) acc.apps.add(r.appId);
  }

  return [...byProvider.entries()]
    .map(([providerSlug, acc]) => ({
      providerSlug,
      sessions: acc.sessions,
      tickets: acc.tickets,
      feeWei: acc.feeWei.toString(),
      networkFeeUsdMicros: acc.networkFeeUsdMicros.toString(),
      accounts: acc.accounts.size,
      apps: acc.apps.size,
    }))
    .sort((a, b) => a.providerSlug.localeCompare(b.providerSlug));
}
