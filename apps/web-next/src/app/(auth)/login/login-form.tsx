'use client';

import { useState, useCallback, useEffect } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/contexts/auth-context';
import { Loader2 } from 'lucide-react';

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

export default function LoginForm() {
  const { login, loginWithOAuth, isLoading, isAuthenticated } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [vhsPlayed, setVhsPlayed] = useState(false);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      const raw = searchParams.get('redirect') || '/dashboard';
      const safeRedirect = raw.startsWith('/') && !raw.startsWith('//') ? raw : '/dashboard';
      router.replace(safeRedirect);
    }
  }, [isLoading, isAuthenticated, router, searchParams]);

  useEffect(() => {
    const oauthError = searchParams.get('error');
    if (oauthError) setError(formatOAuthError(oauthError));
  }, [searchParams]);

  const handleOAuth = useCallback(async (provider: 'google' | 'github') => {
    setError('');
    try { await loginWithOAuth(provider); }
    catch (err) { setError(err instanceof Error ? err.message : 'OAuth login failed'); }
  }, [loginWithOAuth]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    try { await login(email, password); }
    catch (err) { setError(err instanceof Error ? err.message : 'Login failed'); }
  };

  return (
    <div className="w-full max-w-sm px-4">
      {/* Livepeer textmark */}
      <div className="text-center mb-8">
        <div className="inline-block vhs-scanlines">
          <svg viewBox="115 0 596 90" fill="none" xmlns="http://www.w3.org/2000/svg" className={`h-7 w-auto text-foreground ${vhsPlayed ? '' : 'animate-vhs'}`} onAnimationEnd={() => setVhsPlayed(true)}>
          <path d="M118.899 88.6863V0.97998H135.921V73.6405H185.815V88.6863H118.899Z" fill="currentColor"/>
          <path d="M195.932 88.6863V0.97998H212.954V88.6863H195.932Z" fill="currentColor"/>
          <path d="M291.653 0.97998H310.34L277.221 88.6863H255.142L221.283 0.97998H240.34L266.551 70.9493L291.653 0.97998Z" fill="currentColor"/>
          <path d="M319.038 88.6863V52.5316H336.06V37.121H319.038V0.97998H385.955V16.0258H336.06V37.121H378.369V52.5316H336.06V73.6405H387.25V88.6863H319.038Z" fill="currentColor"/>
          <path d="M400.019 88.6863V0.97998H439.798C457.005 0.97998 468.23 9.63853 468.23 26.9229C468.23 42.2786 457.005 52.6235 439.798 52.6235H417.041V88.6863H400.019ZM417.041 37.0306H437.886C446.521 37.0306 451.146 32.8877 451.146 26.7406C451.146 20.1235 446.521 16.0258 437.886 16.0258H417.041V37.0306Z" fill="currentColor"/>
          <path d="M479.889 88.6863V52.5316H496.911V37.121H479.889V0.97998H546.805V16.0258H496.911V37.121H539.219V52.5316H496.911V73.6405H548.1V88.6863H479.889Z" fill="currentColor"/>
          <path d="M560.869 88.6863V52.5316H577.891V37.121H560.869V0.97998H627.785V16.0258H577.891V37.121H620.2V52.5316H577.891V73.6405H629.081V88.6863H560.869Z" fill="currentColor"/>
          <path d="M641.85 88.6863V0.97998H682.925C698.488 0.983166 710.061 8.54418 710.061 22.8274C710.061 33.708 705.127 40.3254 695.013 44.0563C704.202 44.0563 708.766 48.2153 708.766 56.4722V88.6863H691.744V60.6923C691.744 54.3927 689.894 52.5578 683.541 52.5578H658.872V88.6863H641.85ZM658.872 37.0884H677.867C687.797 37.0884 692.977 33.7995 692.977 26.616C692.977 19.4325 687.982 16.0258 677.867 16.0258H658.872V37.0884Z" fill="currentColor"/>
          </svg>
        </div>
        <h1 className="mt-4 text-lg font-medium text-muted-foreground">Sign in to your account</h1>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor="email" className="block text-[13px] font-medium text-muted-foreground mb-1.5">
            Email
          </label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-background border border-muted-foreground/25 rounded-lg text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-muted-foreground/50 focus:ring-1 focus:ring-muted-foreground/20 transition-colors"
            placeholder="you@example.com"
            required
          />
        </div>

        <div>
          <label htmlFor="password" className="block text-[13px] font-medium text-muted-foreground mb-1.5">
            Password
          </label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 text-sm bg-background border border-muted-foreground/25 rounded-lg text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-muted-foreground/50 focus:ring-1 focus:ring-muted-foreground/20 transition-colors"
            placeholder="Enter your password"
            required
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-2 bg-foreground hover:bg-foreground/90 text-background rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
          Continue with email
        </button>
      </form>

      <div className="mt-2 text-center">
        <Link href="/forgot-password" className="text-[13px] text-muted-foreground/60 hover:text-muted-foreground transition-colors">
          Forgot password?
        </Link>
      </div>

      <div className="my-5">
        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border/40" />
          </div>
          <div className="relative flex justify-center text-[11px] uppercase tracking-wider">
            <span className="bg-background px-3 text-muted-foreground/60">or</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2.5">
        <button
          onClick={() => handleOAuth('google')}
          className="flex items-center justify-center gap-2 px-3 py-2 text-sm border border-muted-foreground/25 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <svg className="h-4 w-4" viewBox="0 0 24 24">
            <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
            <path fill="currentColor" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
            <path fill="currentColor" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
            <path fill="currentColor" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
          </svg>
          Google
        </button>
        <button
          onClick={() => handleOAuth('github')}
          className="flex items-center justify-center gap-2 px-3 py-2 text-sm border border-muted-foreground/25 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
        >
          <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
          </svg>
          GitHub
        </button>
      </div>

      <p className="mt-5 text-center text-[13px] text-muted-foreground">
        Don&apos;t have an account?{' '}
        <Link href="/register" className="text-foreground hover:underline">
          Sign up
        </Link>
      </p>
    </div>
  );
}
