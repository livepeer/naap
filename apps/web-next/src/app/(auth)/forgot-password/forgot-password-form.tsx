'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Loader2, ArrowLeft, CheckCircle } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

const inputClass =
  'w-full px-3 py-2 text-sm bg-background border border-muted-foreground/25 rounded-lg text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-muted-foreground/50 focus:ring-1 focus:ring-muted-foreground/20 transition-colors';

export default function ForgotPasswordForm() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [vhsPlayed, setVhsPlayed] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE}/v1/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          throw new Error('Too many attempts. Please wait and try again.');
        }
        throw new Error('Unable to send reset email. Please try again later.');
      }

      setIsSubmitted(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : '';
      setError(msg.includes('Too many') ? msg : 'Unable to send reset email. Please try again later.');
    } finally {
      setIsLoading(false);
    }
  };

  if (isSubmitted) {
    return (
      <div className="w-full max-w-sm px-4 text-center">
        <div className="flex justify-center mb-5">
          <div className="p-2.5 bg-green-500/10 rounded-full">
            <CheckCircle className="h-8 w-8 text-green-500" />
          </div>
        </div>
        <h1 className="text-lg font-medium text-foreground">Check your email</h1>
        <p className="text-[13px] text-muted-foreground mt-2 mb-5">
          We&apos;ve sent a password reset link to <strong className="text-foreground">{email}</strong>
        </p>
        <p className="text-[13px] text-muted-foreground mb-5">
          Didn&apos;t receive the email? Check your spam folder or{' '}
          <button
            onClick={() => setIsSubmitted(false)}
            className="text-foreground hover:underline"
          >
            try again
          </button>
        </p>
        <Link
          href="/login"
          className="inline-flex items-center gap-1.5 text-[13px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back to login
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm px-4">
      {/* AgentBook logo */}
      <div className="text-center mb-8">
        <img src="/agentbook-logo.png" alt="AgentBook" className="h-14 w-auto mx-auto mb-3" />
        <h1 className="text-lg font-medium text-muted-foreground">Reset your password</h1>
        <p className="mt-1 text-[13px] text-muted-foreground/60">
          Enter your email and we&apos;ll send you a reset link
        </p>
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
            className={inputClass}
            placeholder="you@example.com"
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
              Sending...
            </>
          ) : (
            'Send reset link'
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
