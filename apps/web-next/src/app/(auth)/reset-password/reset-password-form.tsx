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
        const data = await response.json();
        throw new Error(data.message || 'Failed to reset password');
      }

      setIsSuccess(true);
      setTimeout(() => router.push('/login'), 3000);
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
        <h1 className="mt-4 text-lg font-medium text-muted-foreground">Choose a new password</h1>
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
