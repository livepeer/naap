/**
 * RequirePermission - Component for RBAC-based UI rendering
 */

import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { usePermissions, WalletPermission } from '../hooks/usePermissions';

interface RequirePermissionProps {
  permission: WalletPermission;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  showFallback?: boolean;
}

/**
 * Render children only if user has the required permission
 */
export const RequirePermission: React.FC<RequirePermissionProps> = ({
  permission,
  children,
  fallback,
  showFallback = true,
}) => {
  const { hasPermission } = usePermissions();

  if (hasPermission(permission)) {
    return <>{children}</>;
  }

  if (!showFallback) {
    return null;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  return <AccessDenied permission={permission} />;
};

interface RequireRoleProps {
  role: string;
  children: React.ReactNode;
  fallback?: React.ReactNode;
  showFallback?: boolean;
}

/**
 * Render children only if user has the required role
 */
export const RequireRole: React.FC<RequireRoleProps> = ({
  role,
  children,
  fallback,
  showFallback = true,
}) => {
  const { hasRole } = usePermissions();

  if (hasRole(role)) {
    return <>{children}</>;
  }

  if (!showFallback) {
    return null;
  }

  if (fallback) {
    return <>{fallback}</>;
  }

  return <AccessDenied role={role} />;
};

interface AccessDeniedProps {
  permission?: WalletPermission;
  role?: string;
  message?: string;
}

/**
 * Access denied message component
 */
export const AccessDenied: React.FC<AccessDeniedProps> = ({
  permission,
  role,
  message,
}) => {
  const displayMessage = message || 
    (permission ? `Requires ${permission} permission` : 
     role ? `Requires ${role} role` : 
     'Access denied');

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <div className="w-16 h-16 rounded-full bg-accent-amber/20 flex items-center justify-center mb-4">
        <AlertTriangle className="w-8 h-8 text-accent-amber" />
      </div>
      <h2 className="text-xl font-semibold text-text-primary mb-2">Access Denied</h2>
      <p className="text-text-secondary max-w-md">{displayMessage}</p>
      <p className="text-sm text-text-secondary mt-2">
        Contact your administrator for access.
      </p>
    </div>
  );
};

export default RequirePermission;
