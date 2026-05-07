const WEI_PER_ETH = 10n ** 18n;

/**
 * Display a decimal wei string as ETH using `BigInt` only (no `Number` on raw wei).
 * Invalid or non-integer strings return an em dash.
 *
 * Uses exact fixed-point division (wei remainder → 18 fractional digits) so small
 * per-pipeline fees are not rounded down to `0` when `maxFractionDigits` was 6
 * (scaling `remainder * 10^6` underflows vs 1 ETH for sub-micro-ETH amounts).
 *
 * @param maxFractionDigits — Round to this many decimal places of ETH (default 18 = exact integer wei).
 */
export function formatFeeWeiStringToEthDisplay(
  wei: string,
  maxFractionDigits = 18,
): string {
  const trimmed = (wei ?? '').trim();
  if (!trimmed) return '0';
  let value: bigint;
  try {
    value = BigInt(trimmed);
  } catch {
    return '—';
  }
  if (value < 0n) return '—';

  const cappedDigits = Math.min(Math.max(0, maxFractionDigits), 18);
  if (cappedDigits <= 0) {
    const roundWei = WEI_PER_ETH;
    value = (value + roundWei / 2n) / roundWei * roundWei;
    return (value / WEI_PER_ETH).toString();
  }

  let roundWei = 1n;
  if (cappedDigits < 18) {
    roundWei = 10n ** BigInt(18 - cappedDigits);
  }
  value = (value + roundWei / 2n) / roundWei * roundWei;

  const whole = value / WEI_PER_ETH;
  const remainder = value % WEI_PER_ETH;
  if (remainder === 0n) {
    return whole.toString();
  }

  const frac = remainder.toString().padStart(18, '0').replace(/0+$/, '');
  return frac.length > 0 ? `${whole.toString()}.${frac}` : whole.toString();
}
