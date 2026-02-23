/**
 * Canonical User & AuthUser types
 *
 * Single source of truth for user identity types across the platform.
 * Consumers should import from '@naap/types' instead of defining local copies.
 */

/** Authenticated user identity returned by the auth API and stored in session */
export interface AuthUser {
  id: string;
  email: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  address: string | null;
  roles: string[];
  permissions: Array<{ resource: string; action: string }> | string[];
  avatar?: string | null;
  walletAddress?: string | null;
}

/**
 * Minimal user identity for frontend contexts (auth-context).
 * Roles and permissions are optional since not all UI components need them.
 */
export type User = Pick<AuthUser, 'id' | 'email' | 'displayName' | 'avatarUrl' | 'address'> & {
  roles?: string[];
  permissions?: string[];
};
