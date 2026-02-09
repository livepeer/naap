/**
 * RequireRole Component
 * 
 * Guards UI elements based on user roles.
 * Use for conditional rendering of admin-only features.
 * 
 * Uses the unified shell IAuthService for authentication.
 */

import { type ReactNode } from 'react';
import { useShell } from '../hooks/useShell.js';
import type { IAuthService } from '../types/services.js';

// Re-export Permission type from services for backward compatibility
export type { Permission } from '../types/services.js';

/**
 * Auth context value interface for backward compatibility
 */
export interface AuthContextValue {
  userId: string | null;
  roles: string[];
  permissions: Array<{ resource: string; action: string; scope?: string }>;
  loading: boolean;
  hasRole: (role: string) => boolean;
  hasAnyRole: (roles: string[]) => boolean;
  hasAllRoles: (roles: string[]) => boolean;
  hasPermission: (resource: string, action: string) => boolean;
}

/**
 * @deprecated Use useAuth from useShell hook instead.
 * This provider is kept for backward compatibility but does nothing.
 * The shell's IAuthService is now used directly.
 */
export function AuthProvider({ children }: { children: ReactNode; userId?: string }) {
  console.warn(
    'AuthProvider is deprecated. The shell\'s IAuthService is now used directly. ' +
    'You can safely remove AuthProvider from your component tree.'
  );
  return <>{children}</>;
}

/**
 * Create an AuthContextValue from the shell's IAuthService
 */
function createAuthContextValue(auth: IAuthService): AuthContextValue {
  const user = auth.getUser();
  const roles = user?.roles || [];
  const permissions = user?.permissions?.map(p => {
    // Parse permission string like "resource:action" or use as-is
    if (typeof p === 'string' && p.includes(':')) {
      const [resource, action] = p.split(':');
      return { resource, action };
    }
    return { resource: String(p), action: '*' };
  }) || [];

  const hasRole = (role: string): boolean => auth.hasRole(role);
  
  const hasAnyRole = (checkRoles: string[]): boolean => 
    checkRoles.some(role => auth.hasRole(role));
  
  const hasAllRoles = (checkRoles: string[]): boolean => 
    checkRoles.every(role => auth.hasRole(role));

  const hasPermission = (resource: string, action: string): boolean => 
    auth.hasPermission(resource, action);

  return {
    userId: user?.id || null,
    roles,
    permissions,
    loading: false, // Shell context is already loaded when available
    hasRole,
    hasAnyRole,
    hasAllRoles,
    hasPermission,
  };
}

/**
 * Hook to access auth context using the shell's IAuthService
 */
export function useAuth(): AuthContextValue {
  const shell = useShell();
  return createAuthContextValue(shell.auth);
}

/**
 * Hook to check if user has a specific role
 */
export function useHasRole(role: string): boolean {
  const shell = useShell();
  return shell.auth.hasRole(role);
}

/**
 * Hook to check if user has any of the specified roles
 */
export function useHasAnyRole(roles: string[]): boolean {
  const shell = useShell();
  return roles.some(role => shell.auth.hasRole(role));
}

/**
 * Hook to check if user has a specific permission
 */
export function useHasPermission(resource: string, action: string): boolean {
  const shell = useShell();
  return shell.auth.hasPermission(resource, action);
}

// Component props
interface RequireRoleProps {
  /** Role(s) required - user needs at least one */
  roles: string | string[];
  /** What to show if role check fails */
  fallback?: ReactNode;
  /** Content to show if role check passes */
  children: ReactNode;
}

/**
 * Guard component that only renders children if user has required role(s)
 * 
 * Uses the shell's IAuthService directly for role checking.
 * 
 * @example
 * ```tsx
 * <RequireRole roles="system:admin">
 *   <AdminPanel />
 * </RequireRole>
 * 
 * <RequireRole roles={['system:admin', 'gateway-manager:admin']}>
 *   <DeleteButton />
 * </RequireRole>
 * 
 * <RequireRole roles="editor" fallback={<ViewOnlyMessage />}>
 *   <Editor />
 * </RequireRole>
 * ```
 */
export function RequireRole({ roles, fallback, children }: RequireRoleProps) {
  const shell = useShell();
  const roleArray = Array.isArray(roles) ? roles : [roles];
  
  const hasRequiredRole = roleArray.some(role => shell.auth.hasRole(role));
  
  if (!hasRequiredRole) {
    return fallback ? <>{fallback}</> : null;
  }

  return <>{children}</>;
}

// Permission-based guard
interface RequirePermissionProps {
  /** Resource to check */
  resource: string;
  /** Action to check */
  action: string;
  /** What to show if permission check fails */
  fallback?: ReactNode;
  /** Content to show if permission check passes */
  children: ReactNode;
}

/**
 * Guard component that only renders children if user has required permission
 * 
 * Uses the shell's IAuthService directly for permission checking.
 * 
 * @example
 * ```tsx
 * <RequirePermission resource="user" action="delete">
 *   <DeleteUserButton />
 * </RequirePermission>
 * ```
 */
export function RequirePermission({ resource, action, fallback, children }: RequirePermissionProps) {
  const shell = useShell();
  
  if (!shell.auth.hasPermission(resource, action)) {
    return fallback ? <>{fallback}</> : null;
  }

  return <>{children}</>;
}

export default RequireRole;
