/**
 * useUser Hook
 * 
 * Provides convenient access to the current authenticated user.
 * This is a convenience wrapper around useAuth().getUser() for consistency
 * with other hooks like useTeam() and useTenant().
 */

import { useState, useEffect } from 'react';
import { useAuth } from './useShell.js';
import type { AuthUser } from '../types/services.js';

/**
 * Hook to get the current authenticated user.
 * 
 * This hook automatically subscribes to auth state changes and updates
 * when the user logs in or out.
 * 
 * @returns The current user or null if not authenticated
 * 
 * @example
 * ```typescript
 * function UserProfile() {
 *   const user = useUser();
 *   
 *   if (!user) {
 *     return <div>Please log in</div>;
 *   }
 *   
 *   return (
 *     <div>
 *       <h1>Welcome, {user.displayName || user.walletAddress}!</h1>
 *       <p>Roles: {user.roles.join(', ')}</p>
 *     </div>
 *   );
 * }
 * ```
 * 
 * @example
 * ```typescript
 * // Check user permissions
 * function AdminPanel() {
 *   const user = useUser();
 *   
 *   if (!user?.roles.includes('admin')) {
 *     return <div>Access denied</div>;
 *   }
 *   
 *   return <div>Admin content</div>;
 * }
 * ```
 */
export function useUser(): AuthUser | null {
  const auth = useAuth();
  const [user, setUser] = useState<AuthUser | null>(() => auth.getUser());

  useEffect(() => {
    // Subscribe to auth state changes
    const unsubscribe = auth.onAuthStateChange((newUser) => {
      setUser(newUser);
    });

    // Also update immediately in case state changed
    setUser(auth.getUser());

    return unsubscribe;
  }, [auth]);

  return user;
}

/**
 * Hook to check if user is authenticated.
 * 
 * @returns True if user is authenticated, false otherwise
 * 
 * @example
 * ```typescript
 * function ProtectedContent() {
 *   const isAuthenticated = useIsAuthenticated();
 *   
 *   if (!isAuthenticated) {
 *     return <LoginPrompt />;
 *   }
 *   
 *   return <Content />;
 * }
 * ```
 */
export function useIsAuthenticated(): boolean {
  const auth = useAuth();
  const [isAuthenticated, setIsAuthenticated] = useState(() => auth.isAuthenticated());

  useEffect(() => {
    const unsubscribe = auth.onAuthStateChange((user) => {
      setIsAuthenticated(user !== null);
    });

    setIsAuthenticated(auth.isAuthenticated());

    return unsubscribe;
  }, [auth]);

  return isAuthenticated;
}

/**
 * Hook to check if user has a specific role.
 * 
 * @param role - The role to check for
 * @returns True if user has the role, false otherwise
 * 
 * @example
 * ```typescript
 * function AdminTools() {
 *   const isAdmin = useHasRole('admin');
 *   
 *   if (!isAdmin) {
 *     return null;
 *   }
 *   
 *   return <AdminToolbar />;
 * }
 * ```
 */
export function useHasRole(role: string): boolean {
  const user = useUser();
  return user?.roles.includes(role) || false;
}

/**
 * Hook to check if user has a specific permission.
 * 
 * @param resource - The resource to check
 * @param action - The action to check
 * @returns True if user has the permission, false otherwise
 * 
 * @example
 * ```typescript
 * function DeleteButton({ itemId }: { itemId: string }) {
 *   const canDelete = useHasPermission('items', 'delete');
 *   
 *   if (!canDelete) {
 *     return null;
 *   }
 *   
 *   return <button onClick={() => deleteItem(itemId)}>Delete</button>;
 * }
 * ```
 */
export function useHasPermission(resource: string, action: string): boolean {
  const auth = useAuth();
  return auth.hasPermission(resource, action);
}
