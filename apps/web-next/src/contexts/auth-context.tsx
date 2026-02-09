'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { User } from '@naap/types';

// Re-export for consumers that import User from here
export type { User };

export interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isLoading: boolean;
  sessionExpiresAt: Date | null;
}

export interface AuthContextValue extends AuthState {
  login: (email: string, password: string) => Promise<void>;
  loginWithOAuth: (provider: 'google' | 'github') => Promise<void>;
  loginWithWallet: (address: string, signature: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<void>;
  hasRole: (role: string) => boolean;
  hasAnyRole: (roles: string[]) => boolean;
  hasPermission: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const STORAGE_KEYS = {
  AUTH_TOKEN: 'naap_auth_token',
  CSRF_TOKEN: 'naap_csrf_token',
} as const;

// Helper to sync token to both localStorage and cookie for middleware access
function setTokenStorage(token: string | null) {
  if (typeof window === 'undefined') return;

  if (token) {
    localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, token);
    // Set cookie for middleware (httpOnly should be handled by server)
    document.cookie = `${STORAGE_KEYS.AUTH_TOKEN}=${token}; path=/; max-age=${60 * 60 * 24 * 7}; samesite=strict`;
  } else {
    localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
    // Clear cookie
    document.cookie = `${STORAGE_KEYS.AUTH_TOKEN}=; path=/; max-age=0`;
  }
}

// Clear ALL auth-related storage (use on logout or invalid session)
function clearAllAuthStorage() {
  if (typeof window === 'undefined') return;

  // Clear tokens
  localStorage.removeItem(STORAGE_KEYS.AUTH_TOKEN);
  localStorage.removeItem(STORAGE_KEYS.CSRF_TOKEN);

  // Clear cookies
  document.cookie = `${STORAGE_KEYS.AUTH_TOKEN}=; path=/; max-age=0`;
  document.cookie = `${STORAGE_KEYS.CSRF_TOKEN}=; path=/; max-age=0`;

  // Clear any cached user data
  try {
    // Clear session storage as well
    sessionStorage.clear();
  } catch {
    // Ignore errors
  }
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

export function AuthProvider({ children }: { children: ReactNode }) {
  const router = useRouter();

  const [state, setState] = useState<AuthState>({
    user: null,
    isAuthenticated: false,
    isLoading: true,
    sessionExpiresAt: null,
  });

  const getToken = useCallback(() => {
    if (typeof window === 'undefined') return null;
    
    // Try localStorage first
    const localToken = localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN);
    if (localToken) return localToken;
    
    // Fallback to reading from cookie (in case localStorage was cleared)
    const cookieMatch = document.cookie.match(new RegExp('(^| )' + STORAGE_KEYS.AUTH_TOKEN + '=([^;]+)'));
    return cookieMatch ? cookieMatch[2] : null;
  }, []);

  const fetchUser = useCallback(async (): Promise<User | null> => {
    const token = getToken();
    if (!token) return null;

    try {
      const response = await fetch(`${API_BASE}/v1/auth/me`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
        },
        credentials: 'include', // Include cookies in request
        cache: 'no-store', // Prevent Next.js from caching
      });

      if (!response.ok) {
        if (response.status === 401) {
          // Clear ALL auth storage on unauthorized (token invalid/expired)
          clearAllAuthStorage();
          return null;
        }
        throw new Error('Failed to fetch user');
      }

      const data = await response.json();

      // Handle both wrapped ({ data: { user } }) and unwrapped ({ user }) responses
      const userData = data.data?.user || data.user;

      // Ensure token is synced to localStorage if it's missing
      if (!localStorage.getItem(STORAGE_KEYS.AUTH_TOKEN) && token) {
        localStorage.setItem(STORAGE_KEYS.AUTH_TOKEN, token);
      }

      return userData;
    } catch (error) {
      console.error('Error fetching user:', error);
      return null;
    }
  }, [getToken]);

  useEffect(() => {
    let mounted = true;
    const initAuth = async () => {
      const user = await fetchUser();
      if (mounted) {
        setState({
          user,
          isAuthenticated: !!user,
          isLoading: false,
          sessionExpiresAt: null,
        });
      }
    };
    initAuth();
    return () => { mounted = false; };
  }, [fetchUser]);

  const login = useCallback(async (email: string, password: string) => {
    setState(prev => ({ ...prev, isLoading: true }));
    try {
      const response = await fetch(`${API_BASE}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Include cookies
        body: JSON.stringify({ email, password }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Login failed');
      }
      const data = await response.json();

      // Handle both wrapped ({ data: { user, token } }) and unwrapped responses
      const userData = data.data?.user || data.user;
      const tokenData = data.data?.token || data.token;
      const expiresAtData = data.data?.expiresAt || data.expiresAt;

      // Store token if provided (for client-side auth checks)
      if (tokenData) {
        setTokenStorage(tokenData);
      }

      setState({
        user: userData,
        isAuthenticated: true,
        isLoading: false,
        sessionExpiresAt: expiresAtData ? new Date(expiresAtData) : null,
      });
      router.push('/dashboard');
    } catch (error) {
      setState(prev => ({ ...prev, isLoading: false }));
      throw error;
    }
  }, [router]);

  const loginWithOAuth = useCallback(async (provider: 'google' | 'github') => {
    try {
      const response = await fetch(`${API_BASE}/v1/auth/oauth/${provider}`, {
        credentials: 'include',
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error?.message || err.message || 'Failed to initiate OAuth');
      }
      const data = await response.json();
      const url = data.data?.url || data.url;
      if (url) {
        window.location.href = url;
      } else {
        throw new Error(`OAuth provider ${provider} is not configured`);
      }
    } catch (error) {
      console.error('OAuth error:', error);
      throw error;
    }
  }, []);

  const loginWithWallet = useCallback(async (address: string, signature: string) => {
    setState(prev => ({ ...prev, isLoading: true }));
    try {
      const response = await fetch(`${API_BASE}/v1/auth/wallet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include', // Include cookies
        body: JSON.stringify({ address, signature }),
      });
      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'Wallet login failed');
      }
      const data = await response.json();

      // Handle both wrapped and unwrapped responses
      const userData = data.data?.user || data.user;
      const tokenData = data.data?.token || data.token;
      const expiresAtData = data.data?.expiresAt || data.expiresAt;

      // Store token if provided
      if (tokenData) {
        setTokenStorage(tokenData);
      }

      setState({
        user: userData,
        isAuthenticated: true,
        isLoading: false,
        sessionExpiresAt: expiresAtData ? new Date(expiresAtData) : null,
      });
      router.push('/dashboard');
    } catch (error) {
      setState(prev => ({ ...prev, isLoading: false }));
      throw error;
    }
  }, [router]);

  const logout = useCallback(async () => {
    const token = getToken();
    if (token) {
      try {
        await fetch(`${API_BASE}/v1/auth/logout`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          credentials: 'include', // Include cookies
        });
      } catch (error) {
        console.error('Logout error:', error);
      }
    }
    // Clear ALL auth storage to ensure clean state
    clearAllAuthStorage();
    setState({
      user: null,
      isAuthenticated: false,
      isLoading: false,
      sessionExpiresAt: null,
    });
    // Force hard navigation to clear any cached state
    window.location.href = '/login';
  }, [getToken, router]);

  const refreshSession = useCallback(async () => {
    const token = getToken();
    if (!token) return;
    try {
      const response = await fetch(`${API_BASE}/v1/auth/refresh`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        credentials: 'include', // Include cookies
      });
      if (!response.ok) throw new Error('Session refresh failed');
      const data = await response.json();

      // Handle both wrapped and unwrapped responses
      const tokenData = data.data?.token || data.token;
      const expiresAtData = data.data?.expiresAt || data.expiresAt;

      // Store token if provided
      if (tokenData) {
        setTokenStorage(tokenData);
      }

      setState(prev => ({
        ...prev,
        sessionExpiresAt: expiresAtData ? new Date(expiresAtData) : null,
      }));
    } catch (error) {
      console.error('Session refresh error:', error);
      await logout();
    }
  }, [getToken, logout]);

  const hasRole = useCallback((role: string) => {
    return state.user?.roles?.includes(role) ?? false;
  }, [state.user]);

  const hasAnyRole = useCallback((roles: string[]) => {
    return roles.some(role => state.user?.roles?.includes(role));
  }, [state.user]);

  const hasPermission = useCallback((permission: string) => {
    if (state.user?.permissions?.includes('*')) return true;
    return state.user?.permissions?.includes(permission) ?? false;
  }, [state.user]);

  const value = useMemo<AuthContextValue>(() => ({
    ...state,
    login,
    loginWithOAuth,
    loginWithWallet,
    logout,
    refreshSession,
    hasRole,
    hasAnyRole,
    hasPermission,
  }), [state, login, loginWithOAuth, loginWithWallet, logout, refreshSession, hasRole, hasAnyRole, hasPermission]);

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

export function RequireAuth({
  children,
  requiredRoles,
  fallback,
}: {
  children: ReactNode;
  requiredRoles?: string[];
  fallback?: ReactNode;
}) {
  const { isAuthenticated, isLoading, hasAnyRole } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.push('/login?redirect=' + encodeURIComponent(pathname));
    }
  }, [isLoading, isAuthenticated, router, pathname]);

  if (isLoading) {
    return fallback ?? (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  // Show loading state while redirecting to login
  if (!isAuthenticated) {
    return fallback ?? (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (requiredRoles && !hasAnyRole(requiredRoles)) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center">
        <h1 className="text-2xl font-bold text-destructive">Access Denied</h1>
        <p className="text-muted-foreground mt-2">You do not have permission to view this page.</p>
      </div>
    );
  }

  return <>{children}</>;
}
