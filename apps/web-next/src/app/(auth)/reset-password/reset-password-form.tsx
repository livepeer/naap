'use client';

import { useState, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, CheckCircle, AlertCircle } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

const inputClass =
  'w-full px-3 py-2 text-sm bg-background border border-muted-foreground/25 rounded-lg text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-muted-foreground/50 focus:ring-1 focus:ring-muted-foreground/20 transition-colors';

function ResetPasswordFormInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [vhsPlayed, setVhsPlayed] = useState(false);
  const [formData, setFormData] = useState({
    password: '',
    confirmPassword: '',
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFormData(prev => ({
      ...prev,
      [e.target.name]: e.target.value,
    }));
    setError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!token) {
      setError('Invalid or missing reset token');
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (formData.password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE}/v1/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          password: formData.password,
        }),
      });

      if (!response.ok) {
        if (response.status === 400 || response.status === 401) {
          throw new Error('Invalid or expired reset token');
        }
        if (response.status === 429) {
          throw new Error('Too many attempts. Please wait and try again.');
        }
        throw new Error('Unable to reset password. Please try again later.');
      }

      setIsSuccess(true);
      // The API already set the auth cookie — redirect to login which will
      // detect the session and forward to dashboard automatically.
      setTimeout(() => router.push('/login'), 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reset password');
    } finally {
      setIsLoading(false);
    }
  };

  if (!token) {
    return (
      <div className="w-full max-w-sm px-4 text-center">
        <div className="flex justify-center mb-5">
          <div className="p-2.5 bg-destructive/10 rounded-full">
            <AlertCircle className="h-8 w-8 text-destructive" />
          </div>
        </div>
        <h1 className="text-lg font-medium text-foreground">Invalid link</h1>
        <p className="text-[13px] text-muted-foreground mt-2 mb-5">
          This password reset link is invalid or has expired.
        </p>
        <Link
          href="/forgot-password"
          className="inline-block py-2 px-4 bg-foreground hover:bg-foreground/90 text-background rounded-lg text-sm font-medium transition-colors"
        >
          Request new link
        </Link>
      </div>
    );
  }

  if (isSuccess) {
    return (
      <div className="w-full max-w-sm px-4 text-center">
        <div className="flex justify-center mb-5">
          <div className="p-2.5 bg-green-500/10 rounded-full">
            <CheckCircle className="h-8 w-8 text-green-500" />
          </div>
        </div>
        <h1 className="text-lg font-medium text-foreground">Password reset</h1>
        <p className="text-[13px] text-muted-foreground mt-2 mb-5">
          Your password has been successfully reset. Redirecting to login...
        </p>
        <Link
          href="/login"
          className="inline-block py-2 px-4 bg-foreground hover:bg-foreground/90 text-background rounded-lg text-sm font-medium transition-colors"
        >
          Go to login
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm px-4">
      {/* AgentBook logo */}
      <div className="text-center mb-8">
        <img src="/agentbook-logo.png" alt="AgentBook" className="h-14 w-auto mx-auto mb-3" />
        <h1 className="text-lg font-medium text-muted-foreground">Choose a new password</h1>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-destructive text-sm">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label htmlFor="password" className="block text-[13px] font-medium text-muted-foreground mb-1.5">
            New password
          </label>
          <input
            id="password"
            name="password"
            type="password"
            value={formData.password}
            onChange={handleChange}
            className={inputClass}
            placeholder="Min. 8 characters"
            required
            minLength={8}
          />
        </div>

        <div>
          <label htmlFor="confirmPassword" className="block text-[13px] font-medium text-muted-foreground mb-1.5">
            Confirm new password
          </label>
          <input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            value={formData.confirmPassword}
            onChange={handleChange}
            className={inputClass}
            placeholder="Confirm your password"
            required
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full py-2 bg-foreground hover:bg-foreground/90 text-background rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {isLoading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Resetting...
            </>
          ) : (
            'Reset password'
          )}
        </button>
      </form>

      <p className="mt-5 text-center text-[13px] text-muted-foreground">
        Remember your password?{' '}
        <Link href="/login" className="text-foreground hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}

export default function ResetPasswordForm() {
  return (
    <Suspense fallback={
      <div className="w-full max-w-sm px-4 flex justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    }>
      <ResetPasswordFormInner />
    </Suspense>
  );
}
