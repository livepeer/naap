/** True when value is a finite USD price greater than zero. */
export function validPositiveUsd(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}
