const WEI_PER_ETH = 10n ** 18n;

/**
 * Display a decimal wei string as ETH using `BigInt` only (no `Number` on raw wei).
 * Invalid or non-integer strings return an em dash.
 */
export function formatFeeWeiStringToEthDisplay(
  wei: string,
  maxFractionDigits = 6,
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

  const whole = value / WEI_PER_ETH;
  const remainder = value % WEI_PER_ETH;
  if (maxFractionDigits <= 0) {
    return whole.toString();
  }

  const scale = 10n ** BigInt(maxFractionDigits);
  const fracRounded = (remainder * scale + WEI_PER_ETH / 2n) / WEI_PER_ETH;
  let fracStr = fracRounded.toString().padStart(maxFractionDigits, '0');
  fracStr = fracStr.replace(/0+$/, '');
  return fracStr.length > 0 ? `${whole.toString()}.${fracStr}` : whole.toString();
}
