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
  if (err instanceof Error) return err.message;
  if (
    err &&
    typeof err === 'object' &&
    typeof (err as Record<string, unknown>).message === 'string'
  ) {
    return (err as Record<string, unknown>).message as string;
  }
  return String(err ?? 'Unknown error');
}
