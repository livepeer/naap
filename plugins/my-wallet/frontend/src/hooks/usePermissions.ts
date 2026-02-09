/**
 * usePermissions - Hook for RBAC permission checks
 * 
 * Permission Strategy:
 * - Any connected wallet user gets basic permissions (read, stake)
 * - Admin operations require my-wallet:admin or system:admin role
 * - Write operations require my-wallet:admin role
 *
 * Migrated to use SDK hooks (useAuth, usePermissions) instead of getShellContext().
 */

import { useMemo } from 'react';
import { useAuth, usePermissions as useSdkPermissions } from '@naap/plugin-sdk';
import { useWallet } from '../context/WalletContext';

export type WalletPermission = 'wallet:read' | 'wallet:write' | 'wallet:stake' | 'wallet:admin';

export interface UsePermissionsReturn {
  hasPermission: (permission: WalletPermission) => boolean;
  hasRole: (role: string) => boolean;
  isAdmin: boolean;
  canStake: boolean;
  canWrite: boolean;
}

/**
 * Check if user has a specific permission
 */
export function usePermissions(): UsePermissionsReturn {
  const { isConnected } = useWallet();
  const auth = useAuth();
  const permSvc = useSdkPermissions();
  
  return useMemo(() => {
    // Get roles from auth service
    const getUserRoles = (): string[] => {
      const user = auth?.getUser?.();
      if (user?.roles && Array.isArray(user.roles)) return user.roles;
      return [];
    };

    const roles = getUserRoles();

    const hasPermission = (permission: WalletPermission): boolean => {
      // Connected wallet users get basic permissions automatically
      if (isConnected) {
        if (permission === 'wallet:read' || permission === 'wallet:stake') {
          return true;
        }
      }
      
      const [resource, action] = permission.split(':');
      
      // Try SDK permission service
      if (permSvc?.can) {
        if (permSvc.can(resource, action)) return true;
      }
      
      // Admins have all permissions
      if (roles.includes('my-wallet:admin') || roles.includes('system:admin')) return true;
      
      // Users with my-wallet:user role have stake permission
      if (roles.includes('my-wallet:user') && (permission === 'wallet:read' || permission === 'wallet:stake')) {
        return true;
      }
      
      return false;
    };

    const hasRole = (role: string): boolean => {
      return roles.includes(role);
    };

    const isAdmin = hasRole('my-wallet:admin') || hasRole('system:admin');
    const canStake = hasPermission('wallet:stake');
    const canWrite = hasPermission('wallet:write');

    return {
      hasPermission,
      hasRole,
      isAdmin,
      canStake,
      canWrite,
    };
  }, [isConnected, auth, permSvc]);
}

export default usePermissions;
