'use client';

import { useState, useEffect, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Mail, Loader2, CheckCircle, AlertCircle } from 'lucide-react';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '/api';

function VerifyEmailInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');
  const email = searchParams.get('email');

  const [status, setStatus] = useState<'verifying' | 'success' | 'error' | 'pending'>('pending');
  const [error, setError] = useState<string | null>(null);
  const [isResending, setIsResending] = useState(false);
  const [resendSuccess, setResendSuccess] = useState(false);

  useEffect(() => {
    if (token) {
      verifyEmail(token);
    }
  }, [token]);

  const verifyEmail = async (verificationToken: string) => {
    setStatus('verifying');
    try {
      const response = await fetch(`${API_BASE}/v1/auth/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: verificationToken }),
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.message || 'Verification failed');
      }

      setStatus('success');
      setTimeout(() => router.push('/login'), 3000);
    } catch (err) {
      setStatus('error');
      setError(err instanceof Error ? err.message : 'Verification failed');
    }
  };

  const handleResend = async () => {
    if (!email) return;

    setIsResending(true);
    setResendSuccess(false);

    try {
      const response = await fetch(`${API_BASE}/v1/auth/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      if (!response.ok) {
        throw new Error('Failed to resend verification email');
      }

      setResendSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend');
    } finally {
      setIsResending(false);
    }
  };

  // Verifying state
  if (status === 'verifying') {
    return (
      <div className="w-full max-w-sm px-4 text-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground mx-auto mb-5" />
        <h1 className="text-lg font-medium text-foreground">Verifying your email...</h1>
        <p className="text-[13px] text-muted-foreground mt-2">
          Please wait while we verify your email address.
        </p>
      </div>
    );
  }

  // Success state
  if (status === 'success') {
    return (
      <div className="w-full max-w-sm px-4 text-center">
        <div className="flex justify-center mb-5">
          <div className="p-2.5 bg-green-500/10 rounded-full">
            <CheckCircle className="h-8 w-8 text-green-500" />
          </div>
        </div>
        <h1 className="text-lg font-medium text-foreground">Email verified</h1>
        <p className="text-[13px] text-muted-foreground mt-2 mb-5">
          Your email has been successfully verified. Redirecting to login...
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

  // Error state (verification failed)
  if (status === 'error') {
    return (
      <div className="w-full max-w-sm px-4 text-center">
        <div className="flex justify-center mb-5">
          <div className="p-2.5 bg-destructive/10 rounded-full">
            <AlertCircle className="h-8 w-8 text-destructive" />
          </div>
        </div>
        <h1 className="text-lg font-medium text-foreground">Verification failed</h1>
        <p className="text-[13px] text-muted-foreground mt-2 mb-5">
          {error || 'The verification link is invalid or has expired.'}
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

  // Pending state (waiting for verification, no token)
  return (
    <div className="w-full max-w-sm px-4 text-center">
      <div className="flex justify-center mb-5">
        <div className="p-2.5 bg-muted rounded-full">
          <Mail className="h-8 w-8 text-muted-foreground" />
        </div>
      </div>
      <h1 className="text-lg font-medium text-foreground">Verify your email</h1>
      <p className="text-[13px] text-muted-foreground mt-2 mb-5">
        {email ? (
          <>We&apos;ve sent a verification email to <strong className="text-foreground">{email}</strong>. Click the link in the email to verify your account.</>
        ) : (
          <>Please check your email for the verification link.</>
        )}
      </p>

      {resendSuccess ? (
        <div className="p-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-500 text-sm mb-5">
          Verification email sent! Please check your inbox.
        </div>
      ) : email && (
        <button
          onClick={handleResend}
          disabled={isResending}
          className="text-foreground hover:underline disabled:opacity-50 flex items-center justify-center gap-2 mx-auto mb-5 text-[13px]"
        >
          {isResending ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Sending...
            </>
          ) : (
            'Resend verification email'
          )}
        </button>
      )}

      <div className="space-y-1.5 text-[13px] text-muted-foreground">
        <p>Didn&apos;t receive the email?</p>
        <ul className="list-disc list-inside text-left max-w-xs mx-auto text-muted-foreground/60">
          <li>Check your spam or junk folder</li>
          <li>Make sure you entered the correct email</li>
          <li>Wait a few minutes and try again</li>
        </ul>
      </div>

      <p className="mt-5 text-center text-[13px] text-muted-foreground">
        <Link href="/login" className="text-foreground hover:underline">
          Back to login
        </Link>
      </p>
    </div>
  );
}

export default function VerifyEmailContent() {
  return (
    <Suspense fallback={
      <div className="w-full max-w-sm px-4 flex justify-center">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    }>
      <VerifyEmailInner />
    </Suspense>
  );
}
