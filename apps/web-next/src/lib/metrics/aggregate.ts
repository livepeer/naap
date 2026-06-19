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

/** Per-pipeline/model usage, keyed `"<pipeline>:<modelId>"`. */
export type CapabilityUsageMap = Record<
  string,
  { tickets?: number; networkFeeUsdMicros?: string }
>;

/** Minimal shape of a stored/ingested usage record needed for aggregation. */
export interface UsageRecordLike {
  providerSlug: string;
  accountId: string;
  appId?: string | null;
  sessions?: number | null;
  tickets?: number | null;
  feeWei?: string | null;
  networkFeeUsdMicros?: string | null;
  /**
   * Optional per-capability rollup (pipeline/model). Present on live-pulled
   * records; stored push records leave it unset, so the aggregated row omits
   * `byCapability` entirely and stays byte-identical to the legacy output.
   */
  byCapability?: CapabilityUsageMap | null;
}

/** One aggregated capability bucket on a provider spend row. */
export interface CapabilitySpend {
  tickets: number;
  networkFeeUsdMicros: string;
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
  /**
   * Per-capability spend, keyed `"<pipeline>:<modelId>"`. Only present when at
   * least one contributing record carried `byCapability` (i.e. the live-pull
   * path); omitted otherwise so legacy/push output is unchanged.
   */
  byCapability?: Record<string, CapabilitySpend>;
}

function addDecimal(acc: bigint, value: string | null | undefined): bigint {
  if (!value) return acc;
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`aggregate: non-decimal monetary value "${value}"`);
  }
  return acc + BigInt(value);
}

interface CapabilityAccumulator {
  tickets: number;
  networkFeeUsdMicros: bigint;
}

interface Accumulator {
  sessions: number;
  tickets: number;
  feeWei: bigint;
  networkFeeUsdMicros: bigint;
  accounts: Set<string>;
  apps: Set<string>;
  byCapability: Map<string, CapabilityAccumulator>;
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
        byCapability: new Map(),
      };
      byProvider.set(r.providerSlug, acc);
    }
    acc.sessions += r.sessions ?? 0;
    acc.tickets += r.tickets ?? 0;
    acc.feeWei = addDecimal(acc.feeWei, r.feeWei);
    acc.networkFeeUsdMicros = addDecimal(acc.networkFeeUsdMicros, r.networkFeeUsdMicros);
    acc.accounts.add(r.accountId);
    if (r.appId) acc.apps.add(r.appId);
    if (r.byCapability) {
      for (const [cap, usage] of Object.entries(r.byCapability)) {
        let capAcc = acc.byCapability.get(cap);
        if (!capAcc) {
          capAcc = { tickets: 0, networkFeeUsdMicros: 0n };
          acc.byCapability.set(cap, capAcc);
        }
        capAcc.tickets += usage.tickets ?? 0;
        capAcc.networkFeeUsdMicros = addDecimal(capAcc.networkFeeUsdMicros, usage.networkFeeUsdMicros);
      }
    }
  }

  return [...byProvider.entries()]
    .map(([providerSlug, acc]) => {
      const row: ProviderSpendRow = {
        providerSlug,
        sessions: acc.sessions,
        tickets: acc.tickets,
        feeWei: acc.feeWei.toString(),
        networkFeeUsdMicros: acc.networkFeeUsdMicros.toString(),
        accounts: acc.accounts.size,
        apps: acc.apps.size,
      };
      // Only surface byCapability when a record actually carried it, so the
      // legacy push/DB path output is unchanged (no empty object emitted).
      if (acc.byCapability.size > 0) {
        row.byCapability = Object.fromEntries(
          [...acc.byCapability.entries()].map(([cap, c]) => [
            cap,
            { tickets: c.tickets, networkFeeUsdMicros: c.networkFeeUsdMicros.toString() },
          ]),
        );
      }
      return row;
    })
    .sort((a, b) => a.providerSlug.localeCompare(b.providerSlug));
}
