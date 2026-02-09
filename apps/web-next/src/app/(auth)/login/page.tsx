'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { Loader2, Trash2 } from 'lucide-react';
import { SIWELoginButton } from '@/components/auth/SIWELoginButton';

// Clear all auth storage - helps recover from stale token situations
function clearAuthStorage() {
  if (typeof window === 'undefined') return;

  // Clear localStorage
  localStorage.removeItem('naap_auth_token');
  localStorage.removeItem('naap_csrf_token');

  // Clear cookies
  document.cookie = 'naap_auth_token=; path=/; max-age=0';
  document.cookie = 'naap_csrf_token=; path=/; max-age=0';

  // Clear session storage
  try {
    sessionStorage.clear();
  } catch {
    // Ignore errors
  }
}

// Map OAuth error codes to user-friendly messages
function formatOAuthError(errorCode: string): string {
  const errorMessages: Record<string, string> = {
    invalid_provider: 'Invalid authentication provider.',
    no_code: 'Authentication was cancelled or failed. Please try again.',
    invalid_state: 'Authentication session expired. Please try again.',
    access_denied: 'Access was denied. Please try again.',
    oauth_failed: 'Authentication failed. Please try again.',
  };
  return errorMessages[errorCode] || decodeURIComponent(errorCode);
}

// SIWE Login Section Component
function SIWELoginSection() {
  return (
    <div className="p-4 border border-border rounded-lg bg-muted/30">
      <SIWELoginButton />
    </div>
  );
}

export default function LoginPage() {
  const { login, loginWithOAuth, isLoading } = useAuth();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [cleared, setCleared] = useState(false);

  // Display OAuth error from callback redirect (e.g., /login?error=invalid_state)
  useEffect(() => {
    const oauthError = searchParams.get('error');
    if (oauthError) {
      setError(formatOAuthError(oauthError));
    }
  }, [searchParams]);

  const handleOAuth = useCallback(async (provider: 'google' | 'github') => {
    setError('');
    try {
      await loginWithOAuth(provider);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'OAuth login failed');
    }
  }, [loginWithOAuth]);

  const handleClearSession = useCallback(() => {
    clearAuthStorage();
    setCleared(true);
    setError('');
    // Auto-hide the cleared message after 3 seconds
    setTimeout(() => setCleared(false), 3000);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    try {
      await login(email, password);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  };

  return (
    <div className="w-full max-w-md p-8 bg-card border border-border rounded-2xl shadow-xl">
      <div className="text-center mb-8">
        <h1 className="text-3xl font-bold text-primary">NaaP</h1>
        <p className="text-muted-foreground mt-2">Sign in to your account</p>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium mb-1">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-4 py-2 bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="you@example.com"
            required
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-medium mb-1">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-4 py-2 bg-muted border border-border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            placeholder="Enter your password"
            required
          />
        </div>

        <div className="flex items-center justify-between text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" className="rounded border-border" />
            <span className="text-muted-foreground">Remember me</span>
          </label>
          <Link href="/forgot-password" className="text-primary hover:underline">
            Forgot password?
          </Link>
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
          Sign In
        </button>
      </form>

      <div className="mt-6">
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs uppercase">
            <span className="bg-card px-2 text-muted-foreground">Or continue with</span>
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={() => handleOAuth('google')}
              className="flex items-center justify-center gap-2 px-4 py-2 border border-border rounded-lg hover:bg-muted transition-colors"
            >
              <svg className="h-5 w-5" viewBox="0 0 24 24">
                <path
                  fill="currentColor"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                />
                <path
                  fill="currentColor"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="currentColor"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="currentColor"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Google
            </button>
            <button
              onClick={() => handleOAuth('github')}
              className="flex items-center justify-center gap-2 px-4 py-2 border border-border rounded-lg hover:bg-muted transition-colors"
            >
              <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z" />
              </svg>
              GitHub
            </button>
          </div>

          {/* Add SIWE Login as a separate option */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs uppercase">
              <span className="bg-card px-2 text-muted-foreground">Or with wallet</span>
            </div>
          </div>

          <SIWELoginSection />
        </div>
      </div>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Do not have an account?{' '}
        <Link href="/register" className="text-primary hover:underline">
          Sign up
        </Link>
      </p>

      {/* Clear Session helper for stale token recovery */}
      <div className="mt-4 pt-4 border-t border-border">
        <button
          type="button"
          onClick={handleClearSession}
          className="w-full flex items-center justify-center gap-2 px-4 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 rounded-lg transition-colors"
        >
          <Trash2 className="h-4 w-4" />
          Clear Session Data
        </button>
        {cleared && (
          <p className="mt-2 text-center text-xs text-green-500">
            Session cleared. You can now log in fresh.
          </p>
        )}
      </div>
    </div>
  );
}
