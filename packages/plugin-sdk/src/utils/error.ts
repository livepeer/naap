/**
 * Error message extraction utilities.
 * Safely extracts a string message from unknown error values.
 */

/**
 * Extracts a safe, human-readable error message from an unknown value.
 * Handles Error instances, objects with a message property, and primitives.
 *
 * @param err - The thrown value (Error, object, string, etc.)
 * @returns A non-empty string suitable for display to users
 */
export function getSafeErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    const msg = err.message?.trim();
    return msg || 'Unknown error';
  }
  if (
    err &&
    typeof err === 'object' &&
    typeof (err as Record<string, unknown>).message === 'string'
  ) {
    const msg = ((err as Record<string, unknown>).message as string).trim();
    return msg || 'Unknown error';
  }
  const msg = String(err ?? '').trim();
  return msg || 'Unknown error';
}
